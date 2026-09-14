import type { RevisionProvider } from "./types.ts";
import type { RunRepository } from "../state/repositories.ts";

export async function recoverInterruptedRun(runId: string, runs: RunRepository, revisions: RevisionProvider): Promise<"retry" | "checks" | "unchanged"> {
  const run = runs.require(runId); const interrupted = runs.markRunningInterrupted(runId); if (!interrupted) return "unchanged"; const current = await revisions.current();
  if (interrupted.state === "IMPLEMENT" && current.id !== interrupted.baseRevisionId) return "checks";
  return "retry";
}
