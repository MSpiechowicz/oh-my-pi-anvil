import type { AgentRole } from "../workflow/types.ts";

const ROLE_LABELS: Record<AgentRole, string> = { planner: "Architect", implementation: "Smith", security: "Sentinel", review: "Inquisitor" };
export function renderAssignment(role: AgentRole, assignment: string): string { return `You are the ${ROLE_LABELS[role]} inside Anvil's Forge.\n\n${assignment}\n\nReturn only the requested structured output.`; }
