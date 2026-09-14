export type WorkflowState = "INIT" | "PLAN" | "IMPLEMENT" | "CHECKS" | "SECURITY" | "REVIEW" | "DONE" | "BLOCKED" | "FAILED" | "CANCELLED";
export type RunStatus = "created" | "running" | "done" | "blocked" | "failed" | "cancelled";
export type AgentRole = "planner" | "implementation" | "security" | "review";
export type GateName = "checks" | "security" | "review";
export type FindingStatus = "open" | "resolved" | "waived" | "superseded";

export interface ArtifactPointer { id: string; path: string; sha256: string; }
export interface WorkspaceRevision { id: string; head: string; stagedSha256: string; unstagedSha256: string; untracked: string[]; }
// Contents are embedded so review evidence never depends on temporary Git objects.
export interface RevisionSnapshot {
  revisionId: string;
  head: string;
  format: "git-tree-v1" | "static-v1";
  files: Array<{ path: string; mode: "100644" | "100755" | "120000"; contentBase64: string }>;
  checksum: string;
}

export interface RunRecord {
  id: string; workflowName: string; workflowVersion: number; configHash: string;
  workspaceRoot: string; objectivePath: string; planPath?: string;
  baseRevisionId: string; currentRevisionId: string; mutationEpoch: number;
  currentState: WorkflowState; status: RunStatus; activeAttemptId?: string;
  maxTotalTokens?: number; maxTotalRequests?: number; maxTransitions?: number; maxWallClockMs?: number;
  usedTokens: number; usedInputTokens: number; usedOutputTokens: number; usedCacheReadTokens: number; usedCacheWriteTokens: number; usedRequests: number; transitionCount: number;
  createdAt: string; updatedAt: string; startedAt?: string; finishedAt?: string;
  blockedReason?: string; failureCode?: string; failureMessage?: string;
  initialHead: string;
}

export type WorkflowProgressKind = "started" | "stage" | "finished";
export interface WorkflowProgressUpdate {
  kind: WorkflowProgressKind;
  run: RunRecord;
}
export type WorkflowProgressHandler = (update: WorkflowProgressUpdate) => void | Promise<void>;

export interface AttemptRecord {
  id: string; runId: string; sequence: number; state: WorkflowState; role?: AgentRole; agentName?: string; modelSelector?: string;
  inputArtifactId?: string; outputArtifactId?: string; baseRevisionId: string; resultRevisionId?: string;
  status: "running" | "completed" | "failed" | "aborted" | "interrupted" | "interrupted_with_changes";
  verdict?: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; tokens: number; requests: number;
  contextTokens?: number; contextWindow?: number; durationMs?: number; startedAt: string; endedAt?: string; errorCode?: string; errorMessage?: string;
}

export interface GateResult { id: string; runId: string; gate: GateName; revisionId: string; mutationEpoch: number; configHash: string; gatePolicyHash: string; verdict: "pass" | "fail" | "findings" | "blocked"; attemptId?: string; artifactId?: string; startedAt: string; endedAt: string; }
export interface FindingRecord { id: string; runId: string; sourceGate: GateName; fingerprint: string; severity: string; category: string; title: string; description: string; fixRequirement?: string; filePath?: string; lineStart?: number; lineEnd?: number; status: FindingStatus; firstSeenEpoch: number; lastSeenEpoch: number; timesSeen: number; reopenCount: number; firstAttemptId: string; lastAttemptId: string; evidenceArtifactId?: string; resolvedAttemptId?: string; resolutionNote?: string; createdAt: string; updatedAt: string; }

export interface PlanOutput { version: 1; summary: string; assumptions: string[]; steps: Array<{ id: string; title: string; objective: string; dependsOn: string[]; fileHints: string[]; symbolHints: string[]; acceptanceCriteria: string[]; risk: "low" | "medium" | "high"; securitySurfaces: string[]; }>; globalAcceptanceCriteria: string[]; requiredChecks: Array<{ id: string; reason: string }>; risks: Array<{ category: string; description: string; mitigation: string }>; replanTriggers: string[]; }
export interface ImplementationOutput { version: 1; status: "completed" | "blocked" | "needs_replan"; summary: string; claimedChangedFiles: string[]; addressedFindingIds: string[]; remainingConcerns: string[]; verification?: Array<{ criterion: string; status: "passed" | "failed" | "not_run"; evidence: string; artifactPaths?: string[] }>; replanReason?: string; durableLessons?: Array<{ content: string; importance: number }>; }
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export interface SecurityOutput { version: 1; verdict: "pass" | "findings" | "blocked"; scope: { revisionId: string; reviewedAreas: string[] }; findings: Array<{ severity: FindingSeverity; category: string; title: string; file?: string; lineStart?: number; lineEnd?: number; symbol?: string; description: string; evidence: string; exploitOrImpact: string; fixRequirement: string; confidence: "high" | "medium" | "low"; }>; residualRisks: string[]; verificationIndependent?: boolean; liveValidation?: boolean; blockedReason?: string; }
export interface ReviewOutput { version: 1; verdict: "pass" | "findings" | "blocked"; acceptance: Array<{ criterion: string; status: "satisfied" | "not_satisfied" | "uncertain"; evidence: string; }>; findings: Array<{ severity: "blocking" | "major" | "minor"; category: string; title: string; file?: string; lineStart?: number; lineEnd?: number; symbol?: string; description: string; evidence: string; fixRequirement: string; }>; notes: string[]; blockedReason?: string; }

export interface AgentUsage { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number; requests?: number; contextTokens?: number; contextWindow?: number; }
export interface AgentRunRequest<TSchema = unknown> { runId: string; attemptId: string; role: AgentRole; agentName: string; model?: string; thinkingLevel?: string; effort?: string | null; assignment: string; context?: string; outputSchema: TSchema; schemaMode: "strict"; cwd: string; baseRevisionId: string; readOnly: boolean; isolation?: { requested: boolean; apply: boolean; merge: "patch" | "branch" }; signal?: AbortSignal; }
export interface AgentRunResult<T> { status: "completed" | "failed" | "aborted"; structured?: T; agentName: string; resolvedModel?: string | null; resolvedThinkingLevel?: string | null; usage: AgentUsage; durationMs?: number; rawArtifactRef?: string; stderrArtifactRef?: string; error?: { code: string; message: string }; }

export interface CheckDefinition { id: string; command: string[]; cwd?: string; env?: Record<string, string>; required: boolean; timeoutMs: number; }
export interface CheckResult { id: string; status: "passed" | "failed" | "timed_out" | "error"; exitCode?: number; durationMs: number; stdoutArtifact?: ArtifactPointer; stderrArtifact?: ArtifactPointer; summary: string; }
export interface RevisionProvider {
  current(): Promise<WorkspaceRevision>;
  changedFiles(from: string, to: string): Promise<string[]>;
  captureSnapshot(expectedRevisionId: string): Promise<RevisionSnapshot>;
  recoverSnapshot(revisionId: string, head: string): Promise<RevisionSnapshot>;
  reviewDiff(base: RevisionSnapshot, target: RevisionSnapshot): Promise<{ patch: string; changedFiles: string[] }>;
}
export interface CheckRunner { run(check: CheckDefinition, input: { cwd: string; signal?: AbortSignal; runId?: string; epoch?: number }): Promise<CheckResult>; }
export interface AgentRunner { run<T>(request: AgentRunRequest): Promise<AgentRunResult<T>>; }

export interface HandoffEnvelope { version: 1; runId: string; role: AgentRole; mutationEpoch: number; revisionId: string; objective: ArtifactPointer; plan?: ArtifactPointer; activePlanSteps?: Array<{ id: string; objective: string }>; acceptance?: ArtifactPointer | string[]; changedFiles?: string[]; openFindings?: Array<{ id: string; source: GateName; severity: string; title: string; location?: string; artifact: ArtifactPointer }>; evidence?: Array<{ kind: string; artifact: ArtifactPointer }>; memory?: Array<{ id?: string; content: string }>; constraints: { maxInlineChars: number; readOnly: boolean; noTranscript: true }; }

export interface Clock { now(): Date; }
export interface MemoryAdapter { recall(role: AgentRole, query: string, options: { limit: number; maxChars: number; signal?: AbortSignal }): Promise<Array<{ id?: string; content: string }>>; retain(lessons: Array<{ content: string; importance: number }>, run: RunRecord): Promise<void>; }
export interface WorkflowConfig { version: 1; workflow: { name: string; }; agents: Record<AgentRole, { agent: string; model?: string; thinkingLevel?: string; effort?: string | null }>; checks: CheckDefinition[]; checksFailFast: boolean; security: { failOn: FindingSeverity[]; maxAttempts: number; policyVersion: number; }; review: { maxAttempts: number; blockOn: Array<"blocking" | "major" | "minor">; policyVersion: number; }; implementation: { maxAttempts: number; isolation: { enabled: boolean; merge: "patch" | "branch"; }; }; planning: { maxGenerations: number; maxAttempts: number; }; budgets: { maxTotalTokens?: number; maxTotalRequests?: number; maxTransitions?: number; maxWallClockMs?: number; perRole: Partial<Record<AgentRole, { maxTokens?: number; maxAttempts?: number; maxRequests?: number }>>; }; context: { maxInlineChars: number; maxMemoryItems: number; maxMemoryChars: number; maxFindingSummaryChars: number; maxChangedFiles: number; }; memory: { enabled: boolean; retainOnSuccess: boolean; maxRetainedLessons: number; }; persistence: { root: string; keepAgentRawArtifacts: boolean; keepCommandLogs: boolean; persistRenderedPrompts: boolean; }; safety: { oneMutatingRunPerWorkspace: boolean; securityMustBeReadOnly: boolean; reviewerMustBeReadOnly: boolean; refusePathEscapeFromWorkspace: boolean; }; }
