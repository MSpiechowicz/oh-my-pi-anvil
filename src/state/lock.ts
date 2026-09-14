import { mkdir, readFile, unlink, open, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { AnvilError } from "../util/errors.ts";

export interface LockRecord { runId: string; pid: number; hostname: string; startedAt: string; heartbeatAt: string; }
export class WorkspaceLock {
  private static active = new Set<string>();
  private held = false;
  constructor(private readonly root: string) {}
  async acquire(runId: string, staleAfterMs = 30 * 60 * 1000): Promise<void> {
    if (WorkspaceLock.active.has(this.root)) throw new AnvilError("RUN_LOCKED", `Workspace already has an active Anvil run: ${this.root}`);
    await mkdir(path.dirname(this.root), { recursive: true });
    const now = new Date().toISOString(); const record: LockRecord = { runId, pid: process.pid, hostname: process.env.HOSTNAME ?? "unknown", startedAt: now, heartbeatAt: now };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { const handle = await open(this.root, "wx"); await handle.writeFile(JSON.stringify(record, null, 2)); await handle.close(); WorkspaceLock.active.add(this.root); this.held = true; return; }
      catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
        let existing: LockRecord | undefined; try { existing = JSON.parse(await readFile(this.root, "utf8")) as LockRecord; } catch { existing = undefined; }
        if (existing && Date.now() - Date.parse(existing.heartbeatAt) < staleAfterMs) throw new AnvilError("RUN_LOCKED", `Workspace locked by run ${existing.runId}`);
        await unlink(this.root).catch(() => undefined);
      }
    }
    throw new AnvilError("RUN_LOCKED", `Workspace lock changed while acquiring: ${this.root}`);
  }
  async heartbeat(): Promise<void> { if (!this.held) return; const record = JSON.parse(await readFile(this.root, "utf8")) as LockRecord; record.heartbeatAt = new Date().toISOString(); const temporary = `${this.root}.${process.pid}.tmp`; await writeFile(temporary, JSON.stringify(record, null, 2)); await rename(temporary, this.root); }
  async release(): Promise<void> { if (!this.held) return; WorkspaceLock.active.delete(this.root); this.held = false; try { await unlink(this.root); } catch { /* already released */ } }
}
