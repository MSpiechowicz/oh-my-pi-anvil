import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "./test-helpers.ts";
import anvilExtension, { type ExtensionContext } from "../src/extension.ts";
import { CommandRouter } from "../src/commands/router.ts";
import { renderStatus } from "../src/ui/render.ts";

type SessionStartHandler = (event: unknown, context: ExtensionContext) => void | Promise<void>;
describe("OMP command registration", () => {
  test("registers Anvil management and Forge workflow commands", () => {
    const registrations: string[] = [];
    anvilExtension({
      registerCommand(name) {
        registrations.push(name);
      },
    });

    expect(registrations).toEqual(["anvil", "forge"]);
  });
  test("renders Anvil management results through the OMP UI", async () => {
    const workspace = await mkdtemp("/tmp/anvil-command-ui-");
    const notices: string[] = [];
    let anvilHandler: ((args: string, context: ExtensionContext) => Promise<void>) | undefined;
    try {
      anvilExtension({
        registerCommand(name, definition) {
          if (name === "anvil") anvilHandler = definition.handler;
        },
      });
      if (!anvilHandler) throw new Error("anvil command was not registered");

      await anvilHandler("/anvil doctor", {
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

  test("opens the Anvil management menu without arguments", async () => {
    const workspace = await mkdtemp("/tmp/anvil-command-menu-");
    const notices: string[] = [];
    const selections = ["Configuration"];
    let anvilHandler: ((args: string, context: ExtensionContext) => Promise<void>) | undefined;
    try {
      anvilExtension({
        registerCommand(name, definition) {
          if (name === "anvil") anvilHandler = definition.handler;
        },
      });
      if (!anvilHandler) throw new Error("anvil command was not registered");
      await anvilHandler("", {
        cwd: workspace,
        hasUI: true,
        ui: {
          select: async (title, options) => {
            expect(title).toBe("Anvil");
            expect(options.join(" ")).toContain("Configuration");
            return selections.shift();
          },
          notify: (message) => {
            notices.push(message);
          },
        },
      });
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain("ANVIL · CONFIGURATION");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });


  test("passes Forge text directly to the workflow as its objective", async () => {
    let receivedObjective = "";
    const summary = {
      run: {
        id: "run_test",
        status: "done",
        currentState: "DONE",
        currentRevisionId: "revision",
        mutationEpoch: 0,
        transitionCount: 0,
        usedTokens: 0,
        usedRequests: 0,
        workspaceRoot: "/tmp",
      },
      attempts: [],
      findings: [],
    } as never;
    const router = new CommandRouter(async () => ({
      engine: {
        start: async (input: { objective: string }) => {
          receivedObjective = input.objective;
          return summary;
        },
      } as never,
      state: { close() {} },
      lock: { acquire: async () => {}, release: async () => {} } as never,
    }));

    const response = await router.handle("Add the requested change", { cwd: "/tmp" });

    expect(receivedObjective).toBe("Add the requested change");
    expect(response).toContain("ANVIL · FORGE RUN run_test");
  });
  test("renders Forge status as aligned metadata with failure details", () => {
    const response = renderStatus({
      run: {
        id: "run_failed",
        status: "failed",
        currentState: "FAILED",
        currentRevisionId: "revision",
        mutationEpoch: 0,
        transitionCount: 2,
        usedTokens: 0,
        usedRequests: 0,
        workspaceRoot: "/tmp",
        failureCode: "AGENT_EXECUTION_FAILED",
        failureMessage: "No OMP child-agent executor is available",
      },
      attempts: [{ state: "PLAN" }],
      findings: [],
    } as never);
    const fields = [
      ["STATUS", "FAILED"],
      ["STAGE", "FAILED"],
      ["REVISION", "revision"],
      ["EPOCH", "0"],
      ["TRANSITIONS", "2"],
      ["FAILURE", "AGENT_EXECUTION_FAILED"],
      ["REASON", "No OMP child-agent executor is available"],
      ["FINDINGS", "0"],
      ["USAGE", "0 tokens · 0 requests"],
      ["ARTIFACTS", "/tmp/.omp/.anvil/runs/run_failed"],
    ];
    const aligned = fields.map(([label, value]) => {
      const row = response.split("\n").find((line) => line.startsWith(`  ${label}`));
      return row?.slice(16) === value;
    });
    expect(aligned.every(Boolean)).toBe(true);
    expect(response.includes("OPEN FINDINGS")).toBe(false);
  });

  test("lists configuration locations with aligned values", async () => {
    const router = new CommandRouter(async () => {
      throw new Error("config inspection should not initialize workflow state");
    });

    const response = await router.handleAdmin("config", { cwd: "/tmp" });
    const labels = [
      "STATUS",
      "Anvil config",
      "OMP model maps",
      "Overlay",
      "Runtime state",
      "Architect",
      "Smith",
      "Sentinel",
      "Inquisitor",
      "Warden",
    ];
    const rows = labels.map((label) => response.split("\n").find((line) => line.startsWith(`  ${label}`)));
    const valueColumns = labels.map((label, index) => {
      const row = rows[index];
      if (!row) return -1;
      return row.indexOf(row.slice(2 + label.length).trimStart(), 2 + label.length);
    });

    expect(response).toContain("GLOBAL LOCATIONS");
    expect(response).toContain("PROJECT LOCATIONS");
    expect(response).toContain("MODEL ROLES");
    expect(response).toContain("COMMANDS");
    expect(valueColumns.every((column) => column === 18)).toBe(true);
  });

  test("reports a valid default status when the global config is absent", async () => {
    const configHome = await mkdtemp("/tmp/anvil-command-status-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      const router = new CommandRouter(async () => {
        throw new Error("config inspection should not initialize workflow state");
      });
      const response = await router.handleAdmin("config", { cwd: "/tmp" });
      expect(response).toContain("  STATUS          VALID");
      expect(response).toContain(`  Anvil config    ${path.join(configHome, "omp", "anvil.yml")} (not present)`);
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(configHome, { recursive: true, force: true });
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
        projectConfig = await readFile(path.join(workspace, ".omp", "anvil.yml"), "utf8");
      } catch {
        // Automatic startup setup is global-only.
      }
      expect(projectConfig).toBe(undefined);

      expect(notices[0]).toContain("Edit this file");
      expect(notices[0]).toContain(globalPath);
      expect(notices[0]).toContain("/anvil doctor");
      expect(notices[0]).toContain("/anvil init");

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
    let anvilHandler: ((args: string, context: ExtensionContext) => Promise<void>) | undefined;
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
          if (name === "anvil") anvilHandler = definition.handler;
        },
        on(event, handler) {
          if (event === "session_start") sessionStart = handler;
        },
      });
      if (!sessionStart || !anvilHandler) throw new Error("Anvil startup handlers were not registered");

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
      expect(notices).toHaveLength(1);
      expect(notices[0].message).toBe("Anvil update available. Run `/anvil update install` to update it.");
      expect(notices[0].level).toBe("warning");
      await anvilHandler("/anvil update check", {
        cwd: packageRoot,
        hasUI: true,
        ui: {
          notify(message, level) {
            notices.push({ message, level });
          },
        },
      });
      expect(notices).toHaveLength(2);
      expect(notices[1].message).toBe(`Anvil ${packageVersion}: Newer release available. Run /anvil update install to update it.`);
      expect(notices[1].level).toBe("info");
      const releaseFetch = globalThis.fetch;
      let noticesAtInstallCheck = 0;
      globalThis.fetch = (...args) => {
        noticesAtInstallCheck = notices.length;
        return releaseFetch(...args);
      };
      await anvilHandler("/anvil update install", {
        cwd: packageRoot,
        hasUI: true,
        ui: {
          notify(message, level) {
            notices.push({ message, level });
          },
        },
      });
      expect(notices).toHaveLength(4);
      expect(noticesAtInstallCheck).toBe(3);
      expect(notices[2].level).toBe("info");
      expect(notices[3].message).toContain("Update failed:");
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

  test("separates Forge objectives from Anvil management commands", async () => {
    const router = new CommandRouter(async () => {
      throw new Error("Forge help should not initialize workflow state");
    });
    const forgeHelp = await router.handle("help", { cwd: "/tmp" });
    const anvilHelp = await router.handleAdmin("help", { cwd: "/tmp" });
    expect(forgeHelp).toContain("/forge <objective>");
    expect(forgeHelp).toContain("/anvil config");
    expect(anvilHelp).toContain("/anvil update check");
    expect(anvilHelp).toContain("/anvil status [run-id]");
  });
});
