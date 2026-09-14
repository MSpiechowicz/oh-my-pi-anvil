import type { AgentRole, WorkflowConfig } from "../workflow/types.ts";

export const ROLE_LABELS = {
  planner: "Architect",
  implementation: "Smith",
  security: "Sentinel",
  review: "Inquisitor",
  scout: "Scout",
  archivist: "Archivist",
} as const satisfies Record<AgentRole, string>;

export const MODEL_ROLE_ALIASES = {
  planner: "architect",
  implementation: "smith",
  security: "sentinel",
  review: "inquisitor",
  scout: "scout",
  archivist: "archivist",
} as const satisfies Record<AgentRole, string>;

export const WORKFLOW_ROLE_ORDER = ["scout", "planner", "implementation", "security", "review", "archivist"] as const satisfies readonly AgentRole[];

export function enabledAgentRoles(config: WorkflowConfig): AgentRole[] {
  return WORKFLOW_ROLE_ORDER.filter((role) => {
    if (role === "scout") return config.scouting.enabled;
    if (role === "archivist") return config.memory.enabled && config.memory.retainOnSuccess && config.memory.archivist;
    return true;
  });
}
