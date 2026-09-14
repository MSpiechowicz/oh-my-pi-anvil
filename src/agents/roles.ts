import type { AgentRole } from "../workflow/types.ts";

export const ROLE_LABELS = {
  planner: "Architect",
  implementation: "Smith",
  security: "Sentinel",
  review: "Inquisitor",
} as const satisfies Record<AgentRole, string>;

export const MODEL_ROLE_ALIASES = {
  planner: "architect",
  implementation: "smith",
  security: "sentinel",
  review: "inquisitor",
} as const satisfies Record<AgentRole, string>;

export const WORKFLOW_ROLE_ORDER = ["planner", "implementation", "security", "review"] as const satisfies readonly AgentRole[];
