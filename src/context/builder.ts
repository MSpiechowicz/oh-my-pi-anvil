import type { ArtifactPointer, AgentRole, FindingRecord, HandoffEnvelope, RunRecord, WorkflowConfig } from "../workflow/types.ts";
import { AnvilError } from "../util/errors.ts";
import { serializeHandoff } from "./serializers.ts";

export interface ContextInput { run: RunRecord; objective: ArtifactPointer; plan?: ArtifactPointer; changedFiles?: string[]; findings?: FindingRecord[]; findingArtifacts?: Record<string, ArtifactPointer>; evidence?: Array<{ kind: string; artifact: ArtifactPointer }>; memory?: Array<{ id?: string; content: string }>; acceptance?: string[]; }
export class ContextBuilder {
  constructor(private readonly config: WorkflowConfig) {}
  build(role: AgentRole, input: ContextInput): { envelope: HandoffEnvelope; text: string } {
    const openFindings = input.findings?.map((finding) => {
      const artifact = input.findingArtifacts?.[finding.id];
      if (!artifact) throw new AnvilError("ARTIFACT_CORRUPT", `Missing persisted evidence for finding ${finding.id}`);
      return { id: finding.id, source: finding.sourceGate, severity: finding.severity, title: finding.title, location: finding.filePath ? `${finding.filePath}:${finding.lineStart ?? "?"}` : undefined, artifact };
    });
    const envelope: HandoffEnvelope = { version: 1, runId: input.run.id, role, mutationEpoch: input.run.mutationEpoch, revisionId: input.run.currentRevisionId, objective: input.objective, plan: input.plan, activePlanSteps: undefined, acceptance: input.acceptance, changedFiles: input.changedFiles?.slice(0, this.config.context.maxChangedFiles), openFindings, evidence: input.evidence, memory: input.memory?.slice(0, this.config.context.maxMemoryItems), constraints: { maxInlineChars: this.config.context.maxInlineChars, readOnly: role === "security" || role === "review" || role === "planner", noTranscript: true } };
    return { envelope, text: serializeHandoff(envelope, this.config.context.maxInlineChars) };
  }
}
