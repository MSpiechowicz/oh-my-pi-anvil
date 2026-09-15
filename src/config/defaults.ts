import type { WorkflowConfig } from "../workflow/types.ts";

export const DEFAULT_CONFIG: WorkflowConfig = {
  version: 1,
  workflow: { name: "secure-code-change" },
  agents: {
    planner: { agent: "architect", model: null, thinkingLevel: null, effort: null },
    implementation: { agent: "smith", model: null, thinkingLevel: null, effort: null },
    security: { agent: "sentinel", model: null, thinkingLevel: null, effort: null },
    review: { agent: "inquisitor", model: null, thinkingLevel: null, effort: null },
    scout: { agent: "scout", model: null, thinkingLevel: null, effort: null },
    archivist: { agent: "archivist", model: null, thinkingLevel: null, effort: null },
  },
  checks: [],
  checksFailFast: true,
  security: { failOn: ["critical", "high", "medium"], policyVersion: 1 },
  review: { blockOn: ["blocking", "major"], policyVersion: 1 },
  implementation: { maxParallel: 4, isolation: { enabled: false, merge: "patch" } },
  planning: { maxGenerations: null },
  clarification: { mode: "auto", maxRounds: 2 },
  scouting: { enabled: true },
  budgets: { maxTotalTokens: null, maxTotalRequests: null, maxTransitions: null, maxWallClockMs: null, perRole: { planner: { maxTokens: null, maxAttempts: null, maxRequests: null }, implementation: { maxTokens: null, maxAttempts: null, maxRequests: null }, security: { maxTokens: null, maxAttempts: null, maxRequests: null }, review: { maxTokens: null, maxAttempts: null, maxRequests: null }, scout: { maxTokens: null, maxAttempts: null, maxRequests: null }, archivist: { maxTokens: null, maxAttempts: null, maxRequests: null } } },
  context: { maxInlineChars: 12000, maxMemoryItems: 5, maxMemoryChars: 5000, maxFindingSummaryChars: 6000, maxChangedFiles: 200 },
  memory: { enabled: true, retainOnSuccess: true, archivist: true, maxRetainedLessons: 3 },
  persistence: { root: ".anvil", keepAgentRawArtifacts: true, keepCommandLogs: true, persistRenderedPrompts: false },
  safety: { oneMutatingRunPerWorkspace: true, securityMustBeReadOnly: true, reviewerMustBeReadOnly: true, refusePathEscapeFromWorkspace: true },
};
