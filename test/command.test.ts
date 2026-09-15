import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "./test-helpers.ts";
import anvilExtension, { type ExtensionContext } from "../src/extension.ts";
import { CommandRouter } from "../src/commands/router.ts";
import { WorkspaceLock } from "../src/state/lock.ts";
import type { WorkflowState } from "../src/workflow/types.ts";
import { renderStatus } from "../src/ui/render.ts";
import type { RunSummary } from "../src/workflow/engine.ts";

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


  test("executes a precise objective after intake accepts it", async () => {
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
      clarify: async () => ({ status: "ready", message: "" }),
      engine: {
        start: async (input: { objective: string }) => {
          receivedObjective = input.objective;
          return summary;
        },
      } as never,
      state: { close() {} },
      lock: { acquire: async () => {}, release: async () => {} } as never,
    }));

    await router.handle("Add the requested change", { cwd: "/tmp" });

    expect(receivedObjective).toBe("Add the requested change");
  });

  test("does not start execution when clarification needs input or is cancelled", async () => {
    for (const status of ["needs_input", "cancelled"] as const) {
      let started = false;
      let released = false;
      let closed = false;
      const router = new CommandRouter(async () => ({
        clarify: async () => ({ status, message: `Intake ${status}` }),
        engine: { start: async () => { started = true; throw new Error("Execution must not start"); } } as never,
        state: { close() { closed = true; } },
        lock: { acquire: async () => {}, release: async () => { released = true; } } as never,
      }));
      await router.handle("Add notifications", { cwd: "/tmp" });
      expect(started).toBe(false);
      expect(released).toBe(true);
      expect(closed).toBe(true);
    }
  });

  test("rejects malformed clarification overrides before opening runtime", async () => {
    let opened = false;
    const router = new CommandRouter(async () => { opened = true; throw new Error("Unexpected runtime"); });
    await router.handle("--clarify=maybe Add notifications", { cwd: "/tmp" });
    expect(opened).toBe(false);
  });

  test("keeps a live intake lock even when the previous run is terminal", async () => {
    const root = await mkdtemp("/tmp/anvil-command-intake-lock-");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let intakes = 0;
    const router = new CommandRouter(async () => ({
      clarify: async () => {
        intakes++;
        entered.resolve();
        if (intakes === 1) await release.promise;
        return { status: "cancelled" as const, message: "Cancelled" };
      },
      engine: { status: () => ({ run: { currentState: "DONE" } }) } as never,
      state: { close() {} },
      lock: new WorkspaceLock(path.join(root, "lock.json")),
    }));
    const first = router.handle("First objective", { cwd: root });
    try {
      await entered.promise;
      const second = await router.handle("Second objective", { cwd: root });
      expect(second).toContain("RUN_LOCKED");
      expect(intakes).toBe(1);
    } finally {
      release.resolve();
      await first;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reclaims a paused run lock without reclaiming an active run lock", async () => {
    const root = await mkdtemp("/tmp/anvil-command-paused-lock-");
    const lockPath = path.join(root, "lock.json");
    const owner = new WorkspaceLock(lockPath);
    let currentState: WorkflowState = "BLOCKED";
    let resumes = 0;
    const summary = () => ({
      run: { id: "run_existing", status: currentState === "BLOCKED" ? "blocked" : "running", currentState, currentRevisionId: "revision", mutationEpoch: 0, transitionCount: 3, usedTokens: 2, usedRequests: 2, workspaceRoot: root },
      attempts: [], findings: [],
    } as never);
    const router = new CommandRouter(async () => ({
      clarify: async () => ({ status: "ready", message: "" }),
      engine: { status: summary, resume: async () => { resumes += 1; return summary(); } } as never,
      state: { close() {} },
      lock: new WorkspaceLock(lockPath),
    }));
    try {
      await owner.acquire("run_existing");
      await router.handleAdmin("resume run_existing", { cwd: root });
      expect(resumes).toBe(1);
      currentState = "CHECKS";
      await owner.acquire("run_existing");
      const locked = await router.handleAdmin("resume run_existing", { cwd: root });
      expect(locked).toContain("RUN_LOCKED");
      expect(resumes).toBe(1);
    } finally {
      await owner.release();
      await rm(root, { recursive: true, force: true });
    }
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
      await readFile(globalPath, "utf8");
      expect(notices).toHaveLength(1);
      let projectConfig: string | undefined;
      try {
        projectConfig = await readFile(path.join(workspace, ".omp", "anvil.yml"), "utf8");
      } catch {
        // Automatic startup setup is global-only.
      }
      expect(projectConfig).toBe(undefined);

      expect(notices[0]).toContain(globalPath);

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

});

test("run reports attribute shared-stage attempts to their actual roles", () => {
  const summary = {
    run: {
      id: "run_roles", status: "done", currentState: "DONE", currentRevisionId: "revision",
      mutationEpoch: 1, transitionCount: 7, usedTokens: 100, usedRequests: 7, workspaceRoot: "/tmp",
    },
    attempts: [
      { state: "PLAN", role: "scout" },
      { state: "PLAN", role: "planner" },
      { state: "IMPLEMENT", role: "planner" },
      { state: "IMPLEMENT", role: "implementation" },
      { state: "CHECKS" },
      { state: "SECURITY", role: "security" },
      { state: "REVIEW", role: "review" },
      { state: "REVIEW", role: "archivist" },
    ],
    findings: [],
    events: [],
  } as unknown as RunSummary;
  const counts = (report: string): Record<string, number> => Object.fromEntries(
    [...report.matchAll(/^\s+(\w+)\s+[━·]+\s+(\d+) attempts?$/gm)].map((match) => [match[1], Number(match[2])]),
  );
  expect(counts(renderStatus(summary))).toEqual({
    Scout: 1, Architect: 2, Smith: 1, Warden: 1, Sentinel: 1, Inquisitor: 1, Archivist: 1,
  });
  const withoutAdvisors = { ...summary, attempts: summary.attempts.filter((attempt) => attempt.role !== "scout" && attempt.role !== "archivist") };
  expect(counts(renderStatus(withoutAdvisors))).toEqual({
    Scout: 0, Architect: 2, Smith: 1, Warden: 1, Sentinel: 1, Inquisitor: 1, Archivist: 0,
  });
});
