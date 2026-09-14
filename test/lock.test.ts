import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "./test-helpers.ts";
import { AnvilError } from "../src/util/errors.ts";
import { WorkspaceLock } from "../src/state/lock.ts";

describe("workspace lock", () => {
  test("serializes active runs and permits reacquisition after release", async () => {
    const root = await mkdtemp("/tmp/anvil-lock-"); const lockPath = path.join(root, "lock.json"); const first = new WorkspaceLock(lockPath); const second = new WorkspaceLock(lockPath);
    await first.acquire("run-a"); let locked = false; let message = ""; try { await second.acquire("run-b"); } catch (error) { locked = error instanceof AnvilError && error.code === "RUN_LOCKED"; message = error instanceof Error ? error.message : String(error); } expect(locked).toBe(true); expect(message).toContain("/anvil status run-a"); await first.release(); await second.acquire("run-b"); await second.release(); await rm(root, { recursive: true, force: true });
  });

  test("reclaims a lock left by an exited local process", async () => {
    const root = await mkdtemp("/tmp/anvil-stale-lock-"); const lockPath = path.join(root, "lock.json");
    await mkdir(path.dirname(lockPath), { recursive: true });
    const timestamp = new Date().toISOString();
    await writeFile(lockPath, JSON.stringify({ runId: "run-dead", pid: 999_999_999, hostname: process.env.HOSTNAME ?? "unknown", startedAt: timestamp, heartbeatAt: timestamp }));
    const lock = new WorkspaceLock(lockPath);
    await lock.acquire("run-new");
    await lock.release();
    await rm(root, { recursive: true, force: true });
  });
  test("does not let an old owner remove a replacement lock", async () => {
    const root = await mkdtemp("/tmp/anvil-replacement-lock-"); const lockPath = path.join(root, "lock.json"); const first = new WorkspaceLock(lockPath); const second = new WorkspaceLock(lockPath); const third = new WorkspaceLock(lockPath);
    await first.acquire("run-finished"); await second.acquire("run-new", undefined, async () => false); await first.release();
    let locked = false; try { await third.acquire("run-third"); } catch (error) { locked = error instanceof AnvilError && error.code === "RUN_LOCKED"; }
    expect(locked).toBe(true); await second.release(); await rm(root, { recursive: true, force: true });
  });
});
