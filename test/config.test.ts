import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "./test-helpers.ts";
import { loadConfig } from "../src/config/load.ts";

describe("workflow configuration", () => {
  test("loads nested YAML lists without changing the fixed workflow", async () => {
    const root = await mkdtemp("/tmp/anvil-config-"); await mkdir(path.join(root, ".omp"), { recursive: true }); await writeFile(path.join(root, ".omp", "orchestrator.yml"), "version: 1\nworkflow:\n  name: secure-code-change\nchecks:\n  - id: typecheck\n    command: [deno, task, typecheck]\n    required: true\n    timeoutMs: 1000\n"); const config = await loadConfig(root); expect(config.checks).toHaveLength(1); expect(config.checks[0].id).toBe("typecheck"); expect(config.checks[0].command).toEqual(["deno", "task", "typecheck"]); await rm(root, { recursive: true, force: true });
  });

  test("rejects unknown configuration keys", async () => {
    const root = await mkdtemp("/tmp/anvil-config-unknown-"); await mkdir(path.join(root, ".omp"), { recursive: true }); await writeFile(path.join(root, ".omp", "orchestrator.yml"), "version: 1\nunknown: true\n"); let rejected = false; try { await loadConfig(root); } catch (error) { rejected = error instanceof Error && error.message.includes("Unknown top-level config key"); } expect(rejected).toBe(true); await rm(root, { recursive: true, force: true });
  });
});
