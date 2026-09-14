import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { AnvilError } from "../src/util/errors.ts";
import { WorkspaceLock } from "../src/state/lock.ts";

describe("workspace lock", () => {
  test("serializes active runs and permits reacquisition after release", async () => {
    const root = await mkdtemp("/tmp/anvil-lock-"); const lockPath = path.join(root, "lock.json"); const first = new WorkspaceLock(lockPath); const second = new WorkspaceLock(lockPath);
    await first.acquire("run-a"); let locked = false; try { await second.acquire("run-b"); } catch (error) { locked = error instanceof AnvilError && error.code === "RUN_LOCKED"; } expect(locked).toBe(true); await first.release(); await second.acquire("run-b"); await second.release(); await rm(root, { recursive: true, force: true });
  });
});
