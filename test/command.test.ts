import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "./test-helpers.ts";
import anvilExtension, { type ExtensionContext } from "../src/extension.ts";
import { CommandRouter } from "../src/commands/router.ts";

type SessionStartHandler = (event: unknown, context: ExtensionContext) => void | Promise<void>;
describe("OMP command registration", () => {
  test("registers forge as the primary command and orchestrate as its compatibility alias", () => {
    const registrations: string[] = [];
    anvilExtension({
      registerCommand(name) {
        registrations.push(name);
      },
    });

    expect(registrations).toEqual(["forge", "orchestrate"]);
  });
  test("renders slash-command results through the OMP UI", async () => {
    const workspace = await mkdtemp("/tmp/anvil-command-ui-");
    const notices: string[] = [];
    let forgeHandler: ((args: string, context: ExtensionContext) => Promise<void>) | undefined;
    try {
      anvilExtension({
        registerCommand(name, definition) {
          if (name === "forge") forgeHandler = definition.handler;
        },
      });
      if (!forgeHandler) throw new Error("forge command was not registered");

      await forgeHandler("/forge doctor", {
        cwd: workspace,
        ui: {
          notify: (message) => {
            notices.push(message);
          },
        },
      });

      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain("ANVIL · DOCTOR");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("creates the global setup on the first OMP session", async () => {
    const configHome = await mkdtemp("/tmp/anvil-command-config-");
    const workspace = await mkdtemp("/tmp/anvil-command-workspace-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    const notices: string[] = [];
    let sessionStart: SessionStartHandler | undefined;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      await mkdir(path.join(workspace, ".git"));
      anvilExtension({
        registerCommand() {},
        on(event, handler) {
          if (event === "session_start") sessionStart = handler;
        },
      });
      if (!sessionStart) throw new Error("session_start handler was not registered");

      await sessionStart({}, {
        cwd: workspace,
        ui: {
          notify: (message) => {
            notices.push(message);
          },
        },
      });
      const globalPath = path.join(configHome, "omp", "anvil.yml");
      expect(await readFile(globalPath, "utf8")).toContain("version: 1");
      expect(notices).toHaveLength(1);
      let projectConfig: string | undefined;
      try {
        projectConfig = await readFile(path.join(workspace, ".omp", "orchestrator.yml"), "utf8");
      } catch {
        // Automatic startup setup is global-only.
      }
      expect(projectConfig).toBe(undefined);

      expect(notices[0]).toContain("Edit this file");
      expect(notices[0]).toContain(globalPath);
      expect(notices[0]).toContain("/forge doctor");
      expect(notices[0]).toContain("/forge init");

      await sessionStart({}, {
        cwd: workspace,
        ui: {
          notify: (message) => {
            notices.push(message);
          },
        },
      });
      expect(notices).toHaveLength(1);
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(configHome, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("reports a managed Anvil update after startup in the background", async () => {
    const configHome = await mkdtemp("/tmp/anvil-update-config-");
    const executableHome = await mkdtemp("/tmp/anvil-update-omp-");
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (!packageJson || typeof packageJson !== "object" || !("version" in packageJson) || typeof packageJson.version !== "string") {
      throw new Error("package.json version is unavailable");
    }
    const packageVersion = packageJson.version;
    const ompPath = path.join(executableHome, "omp");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousPath = process.env.PATH;
    const previousFetch = globalThis.fetch;
    const notices: Array<{ message: string; level?: string }> = [];
    const scheduled: Array<() => void | Promise<void>> = [];
    let sessionStart: SessionStartHandler | undefined;
    let forgeHandler: ((args: string, context: ExtensionContext) => Promise<void>) | undefined;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      process.env.PATH = `${executableHome}${path.delimiter}${previousPath ?? ""}`;
      await mkdir(path.join(configHome, "omp"), { recursive: true });
      await Deno.writeTextFile(path.join(configHome, "omp", "anvil.yml"), "version: 1\n");
      await Deno.writeTextFile(
        ompPath,
        `#!/bin/sh
printf '%s\n' '${
          JSON.stringify({
            marketplace: [{
              id: "oh-my-pi-anvil@omp-anvil",
              scope: "user",
              entries: [{ scope: "user", installPath: packageRoot, version: packageVersion }],
            }],
          })
        }'`,
      );
      await Deno.chmod(ompPath, 0o755);
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            draft: false,
            prerelease: false,
            tag_name: "v999.0.0",
          }),
          { status: 200 },
        );

      anvilExtension({
        registerCommand(name, definition) {
          if (name === "forge") forgeHandler = definition.handler;
        },
        on(event, handler) {
          if (event === "session_start") sessionStart = handler;
        },
      });
      if (!sessionStart || !forgeHandler) throw new Error("Anvil startup handlers were not registered");

      await sessionStart({}, {
        cwd: packageRoot,
        hasUI: true,
        setTimeout(callback) {
          scheduled.push(callback);
          return 1;
        },
        ui: {
          notify(message, level) {
            notices.push({ message, level });
          },
        },
      });
      expect(notices).toHaveLength(0);
      expect(scheduled).toHaveLength(1);

      await scheduled[0]();
      expect(notices).toEqual([{
        message: "Anvil update available. Run `/forge update install` to update it.",
        level: "warning",
      }]);
      await forgeHandler("/forge update check", {
        cwd: packageRoot,
        hasUI: true,
        ui: {
          notify(message, level) {
            notices.push({ message, level });
          },
        },
      });
      expect(notices).toHaveLength(2);
      expect(notices[1].message).toContain("ANVIL · UPDATE AVAILABLE");
      expect(notices[1].message).toContain("LATEST     999.0.0");
      expect(notices[1].level).toBe("info");
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      globalThis.fetch = previousFetch;
      await rm(configHome, { recursive: true, force: true });
      await rm(executableHome, { recursive: true, force: true });
    }
  });

  test("lists forge init in router help", async () => {
    const router = new CommandRouter(async () => {
      throw new Error("help should not initialize workflow state");
    });
    const help = await router.handle("help", { cwd: "/tmp" });
    expect(help).toContain("/forge init");
    expect(help).toContain("/forge update check|install");
  });
});
