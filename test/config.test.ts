import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { describe, expect, test } from "./test-helpers.ts";
import { initConfig } from "../src/config/init.ts";
import { loadConfig } from "../src/config/load.ts";

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
      const globalPath = path.join(configHome, "omp", "anvil.yml");
      const projectPath = path.join(repository, ".omp", "anvil.yml");

      expect(report.global.status).toBe("created");
      expect(report.project?.status).toBe("created");
      expect(report.repositoryRoot).toBe(repository);
      expect(await readFile(globalPath, "utf8")).toContain("version: 1");
      expect(await readFile(projectPath, "utf8")).toContain("version: 1");
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
      let rejected = false;
      try {
        await loadConfig(root);
      } catch (error) {
        rejected = error instanceof Error && error.message.includes("Unknown top-level config key");
      }
      expect(rejected).toBe(true);
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      await rm(root, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  });

});
