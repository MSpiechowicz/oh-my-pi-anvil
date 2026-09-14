import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
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

  test("lists forge init in router help", async () => {
    const router = new CommandRouter(async () => {
      throw new Error("help should not initialize workflow state");
    });
    const help = await router.handle("help", { cwd: "/tmp" });
    expect(help).toContain("/forge init");
  });
});
