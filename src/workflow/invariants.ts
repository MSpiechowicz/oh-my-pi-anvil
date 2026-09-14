import { AnvilError } from "../util/errors.ts";
import type { GateRepository, FindingRepository, RunRepository } from "../state/repositories.ts";
import type { RevisionProvider, RunRecord, WorkflowConfig } from "./types.ts";

export async function assertCanComplete(run: RunRecord, deps: { revisions: RevisionProvider; gates: GateRepository; findings: FindingRepository; runs: RunRepository; config: WorkflowConfig }): Promise<void> {
  const current = await deps.revisions.current();
  if (current.id !== run.currentRevisionId) throw new AnvilError("INVARIANT_VIOLATION", "Workspace revision changed before completion");
  for (const [gate, policyHash] of [["checks", JSON.stringify(deps.config.checks)], ["security", JSON.stringify(deps.config.security)], ["review", JSON.stringify(deps.config.review)]] as const) {
    const passing = deps.gates.currentPass(run.id, gate, current.id, run.configHash, policyHash);
    if (!passing) throw new AnvilError("INVARIANT_VIOLATION", `${gate} has no passing result for the exact current revision`);
  }
  const blocking = deps.findings.list(run.id, "open").filter((finding) => deps.config.security.failOn.includes(finding.severity as never) || deps.config.review.blockOn.includes(finding.severity as never));
  if (blocking.length > 0) throw new AnvilError("INVARIANT_VIOLATION", "Blocking findings remain open");
}
