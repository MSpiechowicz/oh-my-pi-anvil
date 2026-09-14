import type { WorkflowConfig } from "../workflow/types.ts";

export const DEFAULT_CONFIG: WorkflowConfig = {
  version: 1,
  workflow: { name: "secure-code-change" },
  agents: {
    planner: { agent: "architect" },
    implementation: { agent: "smith" },
    security: { agent: "sentinel" },
    review: { agent: "inquisitor" },
    scout: { agent: "scout" },
    archivist: { agent: "archivist" },
  },
  checks: [],
  checksFailFast: true,
  security: { failOn: ["critical", "high", "medium"], maxAttempts: 3, policyVersion: 1 },
  review: { maxAttempts: 3, blockOn: ["blocking", "major"], policyVersion: 1 },
  implementation: { maxAttempts: 6, maxParallel: 4, isolation: { enabled: false, merge: "patch" } },
  planning: { maxGenerations: 2, maxAttempts: 2 },
  scouting: { enabled: true },
  budgets: { maxTotalRequests: 120, maxTransitions: 40, maxWallClockMs: 7200000, perRole: { planner: { maxAttempts: 8 }, implementation: { maxAttempts: 6 }, security: { maxAttempts: 3 }, review: { maxAttempts: 3 }, scout: { maxAttempts: 1 }, archivist: { maxAttempts: 1 } } },
  context: { maxInlineChars: 12000, maxMemoryItems: 5, maxMemoryChars: 5000, maxFindingSummaryChars: 6000, maxChangedFiles: 200 },
  memory: { enabled: true, retainOnSuccess: true, archivist: true, maxRetainedLessons: 3 },
  persistence: { root: ".anvil", keepAgentRawArtifacts: true, keepCommandLogs: true, persistRenderedPrompts: false },
  safety: { oneMutatingRunPerWorkspace: true, securityMustBeReadOnly: true, reviewerMustBeReadOnly: true, refusePathEscapeFromWorkspace: true },
};
