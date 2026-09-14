import { mkdir, readFile, unlink, open, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { AnvilError } from "../util/errors.ts";

export interface LockRecord { runId: string; pid: number; hostname: string; startedAt: string; heartbeatAt: string; token?: string; }
function localHostname(): string { return process.env.HOSTNAME ?? "unknown"; }

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (!(error instanceof Error) || !("code" in error)) return true;
    return error.code !== "ESRCH" && error.code !== "EINVAL";
  }
}

function isValidRecord(value: unknown): value is LockRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<LockRecord>;
  return typeof record.runId === "string" && typeof record.pid === "number" && typeof record.hostname === "string" && typeof record.startedAt === "string" && typeof record.heartbeatAt === "string" && (record.token === undefined || typeof record.token === "string");
}

function lockMessage(root: string, record?: LockRecord): string {
  const run = record?.runId && !record.runId.startsWith("pending_") ? ` ${record.runId}` : "";
  const status = run ? `/anvil status${run}` : "/anvil status";
  return `Workspace already has an active Anvil run${run}: ${root}. Check ${status} for its current stage.`;
}
export class WorkspaceLock {
  private held = false;
  private token: string | undefined;
  constructor(private readonly root: string) {}

  async acquire(runId: string, staleAfterMs = 30 * 60 * 1000, isRunActive?: (runId: string) => boolean | Promise<boolean>): Promise<void> {
    await mkdir(path.dirname(this.root), { recursive: true });
    const now = new Date().toISOString(); const record: LockRecord = { runId, pid: process.pid, hostname: localHostname(), startedAt: now, heartbeatAt: now, token: crypto.randomUUID() };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { await this.writeNewRecord(record); this.token = record.token; this.held = true; return; }
      catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
        const existing = await this.readRecord();
        if (existing && await this.isActive(existing, staleAfterMs, isRunActive)) throw new AnvilError("RUN_LOCKED", lockMessage(this.root, existing));
        await unlink(this.root).catch(() => undefined);
      }
    }
    throw new AnvilError("RUN_LOCKED", `Workspace lock changed while acquiring: ${this.root}`);
  }

  async bindRun(runId: string): Promise<void> {
    if (!this.held) return;
    const record = await this.readRecord();
    if (!record || !this.owns(record)) return;
    record.runId = runId;
    await this.writeRecord(record);
  }

  async heartbeat(): Promise<void> {
    if (!this.held) return;
    const record = await this.readRecord();
    if (!record || !this.owns(record)) return;
    record.heartbeatAt = new Date().toISOString();
    await this.writeRecord(record);
  }

  async release(): Promise<void> {
    if (!this.held) return;
    const record = await this.readRecord();
    if (record && this.owns(record)) await unlink(this.root).catch(() => undefined);
    this.held = false; this.token = undefined;
  }

  private async readRecord(): Promise<LockRecord | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.root, "utf8"));
      return isValidRecord(parsed) ? parsed : undefined;
    } catch { return undefined; }
  }

  private async writeNewRecord(record: LockRecord): Promise<void> {
    const handle = await open(this.root, "wx");
    try { await handle.writeFile(JSON.stringify(record, null, 2)); } finally { await handle.close(); }
  }

  private async writeRecord(record: LockRecord): Promise<void> {
    const temporary = `${this.root}.${process.pid}.${this.token ?? "update"}.tmp`;
    await writeFile(temporary, JSON.stringify(record, null, 2));
    await rename(temporary, this.root);
  }

  private owns(record: LockRecord): boolean {
    return record.token ? record.token === this.token : record.pid === process.pid && record.hostname === localHostname();
  }

  private async isActive(record: LockRecord, staleAfterMs: number, isRunActive?: (runId: string) => boolean | Promise<boolean>): Promise<boolean> {
    if (isRunActive) {
      try { if (!await isRunActive(record.runId)) return false; } catch { return true; }
    }
    if (record.hostname === localHostname()) return processIsAlive(record.pid);
    const age = Date.now() - Date.parse(record.heartbeatAt);
    return Number.isFinite(age) && age < staleAfterMs;
  }
}
