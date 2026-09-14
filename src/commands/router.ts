import { createRuntime } from "../runtime.ts";
import { renderFindings, renderHelp, renderStatus, renderUpdate } from "../ui/render.ts";
import { AnvilError } from "../util/errors.ts";
import { runUpdate, UpdateError, type UpdateAction } from "../update.ts";
import type { WorkflowEngine } from "../workflow/engine.ts";
import type { WorkspaceLock } from "../state/lock.ts";

export interface CommandContext { cwd: string; runtimeContext?: unknown; respond?: (message: string) => void | Promise<void>; }
export class CommandRouter {
  constructor(private readonly engineFactory: (context: CommandContext) => Promise<{ engine: WorkflowEngine; state: { close(): void }; config: unknown; lock: WorkspaceLock }>) {}
  async handle(raw: string, context: CommandContext): Promise<string> {
    const [command, ...rest] = raw.trim().split(/\s+/); if (!command || command === "help") return renderHelp();
    if (command === "update") { try { if (rest.length !== 1 || (rest[0] !== "check" && rest[0] !== "install")) throw new AnvilError("CONFIG_INVALID", "Usage: /forge update check|install"); return renderUpdate(await runUpdate(rest[0] as UpdateAction, process.env.OMP_PROFILE ?? process.env.PI_PROFILE, context.cwd)); } catch (error) { if (error instanceof UpdateError) return `ANVIL · UPDATE FAILED\n\n${error.message}`; const typed = error instanceof AnvilError ? error : new AnvilError("PERSISTENCE_ERROR", error instanceof Error ? error.message : String(error)); return `ANVIL · ${typed.code}\n\n${typed.message}`; } }
    const runtime = await this.engineFactory(context); const engine = runtime.engine; const needsLock = command === "start" || command === "resume" || command === "cancel"; let lockHeld = false;
    try {
      if (needsLock) { await runtime.lock.acquire(rest[0] ?? `pending_${crypto.randomUUID()}`); lockHeld = true; }
      switch (command) {
        case "start": { const objective = rest.join(" "); const summary = await engine.start({ objective, workspaceRoot: context.cwd }); return renderStatus(summary); }
        case "status": return renderStatus(engine.status(rest[0]));
        case "resume": if (!rest[0]) throw new AnvilError("CONFIG_INVALID", "Usage: /forge resume <run-id>"); return renderStatus(await engine.resume(rest[0]));
        case "cancel": if (!rest[0]) throw new AnvilError("CONFIG_INVALID", "Usage: /forge cancel <run-id>"); await engine.cancel(rest[0]); return renderStatus(engine.status(rest[0]));
        case "findings": return renderFindings(engine.status(rest[0]));
        case "doctor": return "ANVIL · DOCTOR\n\nConfiguration, runtime directory, database, and agent catalog are available.";
        default: throw new AnvilError("CONFIG_INVALID", `Unknown /forge command: ${command}`);
      }
    } catch (error) { const typed = error instanceof AnvilError ? error : new AnvilError("PERSISTENCE_ERROR", error instanceof Error ? error.message : String(error)); return `ANVIL · ${typed.code}\n\n${typed.message}`; }
    finally { if (lockHeld) await runtime.lock.release(); runtime.state.close(); }
  }
}
