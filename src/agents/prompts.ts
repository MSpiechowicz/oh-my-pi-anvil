import { ROLE_LABELS } from "./roles.ts";
import type { AgentRole } from "../workflow/types.ts";

export function renderAssignment(role: AgentRole, assignment: string): string { return `You are the ${ROLE_LABELS[role]} inside Anvil's Forge.\n\n${assignment}\n\nReturn only the requested structured output.`; }
