import { boundedText, stableJson } from "../util/json.ts";
import type { HandoffEnvelope } from "../workflow/types.ts";

export function serializeHandoff(envelope: HandoffEnvelope, maxChars: number): string {
  const required = { version: envelope.version, runId: envelope.runId, role: envelope.role, mutationEpoch: envelope.mutationEpoch, revisionId: envelope.revisionId, objective: envelope.objective, plan: envelope.plan, constraints: envelope.constraints };
  const optional = { activePlanSteps: envelope.activePlanSteps, acceptance: envelope.acceptance, openFindings: envelope.openFindings, evidence: envelope.evidence, memory: envelope.memory, changedFiles: envelope.changedFiles };
  let rendered = stableJson({ ...required, ...optional });
  if (rendered.length <= maxChars) return rendered;
  const reduced = { ...required, acceptance: envelope.acceptance, openFindings: envelope.openFindings?.map(({ id, source, severity, title, artifact }) => ({ id, source, severity, title, artifact })), changedFiles: envelope.changedFiles?.slice(0, 50) };
  rendered = stableJson(reduced);
  return rendered.length <= maxChars ? rendered : boundedText(rendered, maxChars);
}
