import { boundedText, stableJson } from "../util/json.ts";
import { AnvilError } from "../util/errors.ts";
import type { HandoffEnvelope } from "../workflow/types.ts";

export function serializeHandoff(envelope: HandoffEnvelope, maxChars: number): string {
  const required = { version: envelope.version, runId: envelope.runId, role: envelope.role, mutationEpoch: envelope.mutationEpoch, revisionId: envelope.revisionId, objective: envelope.objective, plan: envelope.plan, constraints: envelope.constraints, evidence: envelope.evidence };
  const optional = { activePlanSteps: envelope.activePlanSteps, acceptance: envelope.acceptance, openFindings: envelope.openFindings, memory: envelope.memory, changedFiles: envelope.changedFiles };
  let rendered = stableJson({ ...required, ...optional });
  if (rendered.length <= maxChars) return rendered;
  const reduced = { ...required, acceptance: envelope.acceptance, openFindings: envelope.openFindings?.map(({ id, source, severity, title, artifact }) => ({ id, source, severity, title, artifact })), changedFiles: envelope.changedFiles?.slice(0, 50) };
  rendered = stableJson(reduced);
  if (rendered.length > maxChars && envelope.evidence?.length) {
    rendered = stableJson({ ...required, acceptance: reduced.acceptance, openFindings: reduced.openFindings });
    if (rendered.length > maxChars) throw new AnvilError("AGENT_EXECUTION_FAILED", `Required handoff evidence and review criteria exceed context.maxInlineChars (${maxChars}); increase this limit before starting a new run. Evidence, findings, and acceptance criteria cannot be truncated safely.`);
    return rendered;
  }
  return rendered.length <= maxChars ? rendered : boundedText(rendered, maxChars);
}
