import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { describe, expect, test } from "./test-helpers.ts";
import { initConfig } from "../src/config/init.ts";
import { loadConfig } from "../src/config/load.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { validateConfig } from "../src/config/schema.ts";
import { BudgetManager } from "../src/budget/ledger.ts";
import type { RunRecord } from "../src/workflow/types.ts";

describe("workflow configuration", () => {
  test("uses global config values when no project overlay exists", async () => {
    const root = await mkdtemp("/tmp/anvil-config-global-");
    const configHome = await mkdtemp("/tmp/anvil-config-home-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      const globalPath = path.join(configHome, "omp", "anvil.yml");
      await mkdir(path.dirname(globalPath), { recursive: true });
      await writeFile(globalPath, "version: 1\nworkflow:\n  name: global-workflow\nbudgets:\n  maxTotalRequests: 17\n");

      const config = await loadConfig(root);
      expect(config.workflow.name).toBe("global-workflow");
      expect(config.budgets.maxTotalRequests).toBe(17);
      expect(config.implementation.maxParallel).toBe(4);
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(root, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  });

  test("nearest repository overlay overrides global values", async () => {
    const repository = await mkdtemp("/tmp/anvil-config-project-");
    const configHome = await mkdtemp("/tmp/anvil-config-home-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      const workspace = path.join(repository, "nested", "workspace");
      await mkdir(path.join(repository, ".git"));
      await mkdir(workspace, { recursive: true });
      const globalPath = path.join(configHome, "omp", "anvil.yml");
      const projectPath = path.join(repository, ".omp", "anvil.yml");
      await mkdir(path.dirname(globalPath), { recursive: true });
      await mkdir(path.dirname(projectPath), { recursive: true });
      await writeFile(globalPath, "version: 1\nworkflow:\n  name: global-workflow\n");
      await writeFile(projectPath, "version: 1\nworkflow:\n  name: repository-workflow\n");

      const config = await loadConfig(workspace);
      expect(config.workflow.name).toBe("repository-workflow");
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(repository, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  });

  test("initializes global and repository configuration files", async () => {
    const repository = await mkdtemp("/tmp/anvil-config-init-");
    const configHome = await mkdtemp("/tmp/anvil-config-home-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      await mkdir(path.join(repository, ".git"));
      await mkdir(path.join(repository, "workspace"));
      const report = await initConfig(path.join(repository, "workspace"));

      expect(report.global.status).toBe("created");
      expect(report.project?.status).toBe("created");
      expect(report.repositoryRoot).toBe(repository);
      const config = await loadConfig(path.join(repository, "workspace"));
      const budget = new BudgetManager(config);
      const run = budgetRun();
      expect(config.budgets.maxTotalTokens).toBe(undefined);
      assert.doesNotThrow(() => budget.assertMayContinue(run));
      for (const role of ["planner", "implementation", "security", "review"] as const) {
        expect(config.budgets.perRole[role]?.maxTokens).toBe(undefined);
        assert.doesNotThrow(() => budget.assertRoleMayRun(run, role, 0, run.usedTokens));
        assert.throws(() => budget.assertRoleMayRun(run, role, config.budgets.perRole[role]!.maxAttempts!, run.usedTokens), { code: "MAX_ATTEMPTS_EXCEEDED" });
      }
      assert.throws(() => budget.assertMayContinue({ ...run, usedRequests: config.budgets.maxTotalRequests! }), { code: "BUDGET_EXHAUSTED" });
      assert.throws(() => budget.assertMayContinue({ ...run, transitionCount: config.budgets.maxTransitions! }), { code: "BUDGET_EXHAUSTED" });
      assert.throws(() => budget.assertMayContinue({ ...run, createdAt: "2000-01-01T00:00:00.000Z" }), { code: "BUDGET_EXHAUSTED" });
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(repository, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  });

  test("reports existing files and preserves modified content on a second init", async () => {
    const repository = await mkdtemp("/tmp/anvil-config-idempotent-");
    const configHome = await mkdtemp("/tmp/anvil-config-home-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      await mkdir(path.join(repository, ".git"));
      await initConfig(repository);
      const globalPath = path.join(configHome, "omp", "anvil.yml");
      const projectPath = path.join(repository, ".omp", "anvil.yml");
      const modifiedGlobal = "version: 1\nworkflow:\n  name: modified-global\n";
      const modifiedProject = "version: 1\nworkflow:\n  name: modified-project\n";
      await writeFile(globalPath, modifiedGlobal);
      await writeFile(projectPath, modifiedProject);

      const report = await initConfig(repository);
      expect(report.global.status).toBe("existing");
      expect(report.project?.status).toBe("existing");
      expect(report.created).toHaveLength(0);
      expect(report.existing).toHaveLength(2);
      expect(await readFile(globalPath, "utf8")).toBe(modifiedGlobal);
      expect(await readFile(projectPath, "utf8")).toBe(modifiedProject);
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(repository, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  });


  test("loads nested YAML lists without changing the fixed workflow", async () => {
    const root = await mkdtemp("/tmp/anvil-config-");
    const configHome = await mkdtemp("/tmp/anvil-config-home-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      await mkdir(path.join(root, ".omp"), { recursive: true });
      await writeFile(path.join(root, ".omp", "anvil.yml"), "version: 1\nworkflow:\n  name: secure-code-change\nchecks:\n  - id: typecheck\n    command: [deno, task, typecheck]\n    required: true\n    timeoutMs: 1000\n");
      const config = await loadConfig(root);
      expect(config.checks).toHaveLength(1);
      expect(config.checks[0].id).toBe("typecheck");
      expect(config.checks[0].command).toEqual(["deno", "task", "typecheck"]);
      await writeFile(path.join(root, ".omp", "anvil.yml"), "checks: []\n");
      expect((await loadConfig(root)).checks).toEqual([]);
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(root, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  });

  test("discovers package checks without an overlay and honors the declared manager over lockfiles", async () => {
    const root = await mkdtemp("/tmp/anvil-config-discovery-");
    const configHome = await mkdtemp("/tmp/anvil-config-home-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      await writeFile(path.join(root, "bun.lockb"), "");
      await writeFile(path.join(root, "package.json"), JSON.stringify({
        packageManager: "yarn@1.22.21",
        scripts: {
          dev: "vite dev", check: "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
          "check:watch": "svelte-check --watch", test: "vitest", build: "vite build",
          lint: "prettier --check . && eslint .", "lint:fix": "eslint --fix .", format: "prettier --write .",
        },
      }));
      const config = await loadConfig(root);
      const commands = Object.fromEntries(config.checks.map((check) => [check.id, check.command]));
      assert.deepEqual(commands, {
        check: ["yarn", "run", "check"], test: ["yarn", "run", "test", "run"],
        build: ["yarn", "run", "build"], lint: ["yarn", "run", "lint"],
      });
      await assert.rejects(readFile(path.join(root, ".omp", "anvil.yml")), { code: "ENOENT" });
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(root, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  });

  test("explicit checks bypass discovery while an empty overlay enables it", async () => {
    const root = await mkdtemp("/tmp/anvil-config-discovery-override-");
    const configHome = await mkdtemp("/tmp/anvil-config-home-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      const globalPath = path.join(configHome, "omp", "anvil.yml");
      await mkdir(path.dirname(globalPath), { recursive: true });
      await writeFile(globalPath, JSON.stringify({ checks: [
        { id: "custom", command: ["custom-validator"], required: true, timeoutMs: 1000 },
      ] }));
      await writeFile(path.join(root, "package.json"), "{ invalid manifest");
      assert.deepEqual((await loadConfig(root)).checks.map((check) => check.command), [["custom-validator"]]);
      await mkdir(path.join(root, ".omp"));
      await writeFile(path.join(root, ".omp", "anvil.yml"), "checks: []\n");
      await assert.rejects(loadConfig(root), { code: "CONFIG_INVALID" });
      await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { check: "tsc --noEmit" } }));
      assert.deepEqual((await loadConfig(root)).checks.map((check) => check.command), [["npm", "run", "check"]]);
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(root, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  });

  test("does not infer verification from mutating or persistent scripts", async () => {
    const root = await mkdtemp("/tmp/anvil-config-discovery-modes-");
    const configHome = await mkdtemp("/tmp/anvil-config-home-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: {
        check: "tsc --watch", lint: "eslint --fix .", test: "vitest --watch",
        build: "vite build --watch", dev: "vite", format: "prettier --write .",
      } }));
      assert.deepEqual((await loadConfig(root)).checks, []);
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(root, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  });

  test("rejects unknown configuration keys", async () => {
    const root = await mkdtemp("/tmp/anvil-config-unknown-");
    const configHome = await mkdtemp("/tmp/anvil-config-home-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      await mkdir(path.join(root, ".omp"), { recursive: true });
      await writeFile(path.join(root, ".omp", "anvil.yml"), "version: 1\nunknown: true\n");
      await assert.rejects(loadConfig(root), { code: "CONFIG_INVALID" });
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(root, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  });

  test("inherits configured token caps and lets YAML and JSON overlays disable them without removing guardrails", async () => {
    const repository = await mkdtemp("/tmp/anvil-config-token-caps-");
    const configHome = await mkdtemp("/tmp/anvil-config-home-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = configHome;
      await mkdir(path.join(repository, ".git"));
      const globalPath = path.join(configHome, "omp", "anvil.yml");
      const projectPath = path.join(repository, ".omp", "anvil.yml");
      await mkdir(path.dirname(globalPath), { recursive: true });
      await mkdir(path.dirname(projectPath), { recursive: true });
      const roles = ["planner", "implementation", "security", "review"] as const;
      await writeFile(globalPath, "budgets:\n  maxTotalTokens: 100\n  maxTotalRequests: 17\n  maxTransitions: 21\n  maxWallClockMs: 60000\n  perRole:\n" + roles.map((role) => `    ${role}:\n      maxTokens: 10.5\n      maxAttempts: 2\n      maxRequests: 7\n`).join(""));
      await writeFile(projectPath, "workflow:\n  name: inherited-token-caps\n");
      const inherited = await loadConfig(repository);
      const run = budgetRun();
      const capped = new BudgetManager(inherited);
      assert.doesNotThrow(() => capped.assertMayContinue({ ...run, usedTokens: 99 }));
      assert.throws(() => capped.assertMayContinue({ ...run, usedTokens: 100 }), { code: "BUDGET_EXHAUSTED" });
      for (const role of roles) {
        assert.doesNotThrow(() => capped.assertRoleMayRun(run, role, 0, 10));
        assert.throws(() => capped.assertRoleMayRun(run, role, 0, 10.5), { code: "BUDGET_EXHAUSTED" });
      }

      await writeFile(projectPath, "budgets:\n  maxTotalTokens: 200\n  perRole:\n    implementation:\n      maxTokens: 30\n");
      const overridden = new BudgetManager(await loadConfig(repository));
      assert.doesNotThrow(() => overridden.assertMayContinue({ ...run, usedTokens: 199 }));
      assert.throws(() => overridden.assertMayContinue({ ...run, usedTokens: 200 }), { code: "BUDGET_EXHAUSTED" });
      assert.doesNotThrow(() => overridden.assertRoleMayRun(run, "implementation", 0, 29));
      assert.throws(() => overridden.assertRoleMayRun(run, "implementation", 0, 30), { code: "BUDGET_EXHAUSTED" });
      assert.throws(() => overridden.assertRoleMayRun(run, "planner", 0, 10.5), { code: "BUDGET_EXHAUSTED" });

      for (const overlay of [
        "budgets:\n  maxTotalTokens: null\n  perRole:\n" + roles.map((role) => `    ${role}:\n      maxTokens: null\n`).join(""),
        JSON.stringify({ budgets: { maxTotalTokens: null, perRole: Object.fromEntries(roles.map((role) => [role, { maxTokens: null }])) } }),
      ]) {
        await writeFile(projectPath, overlay);
        const config = await loadConfig(repository);
        const unlimited = new BudgetManager(config);
        expect(config.budgets.maxTotalTokens).toBe(undefined);
        assert.doesNotThrow(() => unlimited.assertMayContinue(run));
        for (const role of roles) {
          expect(config.budgets.perRole[role]?.maxTokens).toBe(undefined);
          expect(config.budgets.perRole[role]?.maxRequests).toBe(7);
          assert.doesNotThrow(() => unlimited.assertRoleMayRun(run, role, 1, run.usedTokens));
          assert.throws(() => unlimited.assertRoleMayRun(run, role, 2, run.usedTokens), { code: "MAX_ATTEMPTS_EXCEEDED" });
        }
        assert.throws(() => unlimited.assertMayContinue({ ...run, usedRequests: 17 }), { code: "BUDGET_EXHAUSTED" });
        assert.throws(() => unlimited.assertMayContinue({ ...run, transitionCount: 21 }), { code: "BUDGET_EXHAUSTED" });
        assert.throws(() => unlimited.assertMayContinue({ ...run, createdAt: new Date(Date.now() - 60001).toISOString() }), { code: "BUDGET_EXHAUSTED" });
      }
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(repository, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  });

  test("rejects non-positive, non-finite and non-number token limits", () => {
    for (const value of [0, -1, NaN, Infinity, -Infinity, "100", true, {}, []]) {
      const totalConfig = structuredClone(DEFAULT_CONFIG);
      Object.assign(totalConfig.budgets, { maxTotalTokens: value });
      assert.throws(() => validateConfig(totalConfig), { code: "CONFIG_INVALID" });
      for (const role of ["planner", "implementation", "security", "review"] as const) {
        const roleConfig = structuredClone(DEFAULT_CONFIG);
        Object.assign(roleConfig.budgets.perRole[role]!, { maxTokens: value });
        assert.throws(() => validateConfig(roleConfig), { code: "CONFIG_INVALID" });
      }
    }
  });

  test("defaults legacy implementation configuration and accepts bounded parallelism", () => {
    const legacy = structuredClone(DEFAULT_CONFIG);
    delete legacy.implementation.maxParallel;
    expect(validateConfig(legacy).implementation.maxParallel).toBe(4);
    for (const maxParallel of [1, 32]) {
      const config = structuredClone(DEFAULT_CONFIG);
      config.implementation.maxParallel = maxParallel;
      expect(validateConfig(config).implementation.maxParallel).toBe(maxParallel);
    }
  });

  test("rejects out-of-range or non-integer Smith parallelism without coercion", () => {
    for (const maxParallel of [0, -1, 33, 1.5, NaN, Infinity, "4", null, true]) {
      const config = structuredClone(DEFAULT_CONFIG);
      Object.assign(config.implementation, { maxParallel });
      assert.throws(() => validateConfig(config), { code: "CONFIG_INVALID" });
    }
  });

});

function budgetRun(): RunRecord {
  return {
    id: "budget-run", workflowName: "secure-code-change", workflowVersion: 1, configHash: "config",
    workspaceRoot: "/tmp", objectivePath: "objective.md", baseRevisionId: "base", currentRevisionId: "base",
    mutationEpoch: 0, currentState: "PLAN", status: "running", initialHead: "head",
    usedTokens: 1_000_000_000, usedInputTokens: 1_000_000_000, usedOutputTokens: 0, usedCacheReadTokens: 0, usedCacheWriteTokens: 0,
    usedRequests: 0, transitionCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}
