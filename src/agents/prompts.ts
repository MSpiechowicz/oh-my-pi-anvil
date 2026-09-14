import { ROLE_LABELS } from "./roles.ts";
import type { AgentRole } from "../workflow/types.ts";

export function renderAssignment(role: AgentRole, assignment: string): string {
  const advisory = role === "scout"
    ? "\n\nReconnaissance only: inspect the supplied objective and repository, identify relevant areas, risks, and recommendations. Do not implement changes, decide the plan, mark gates passed, or spawn workers. Remain read-only and return bounded advisory ScoutOutput."
    : role === "archivist"
    ? "\n\nRead the supplied persisted plan, implementation, and verification evidence. Curate only durable, project-specific lessons grounded in those artifacts. Remain read-only: never save memory yourself, modify files, change workflow state, or spawn workers. Exclude secrets, credentials, personal data, transient run details, and unverified claims. Return bounded advisory ArchivistOutput; an empty lessons array is valid."
    : "";
  return `You are the ${ROLE_LABELS[role]} inside Anvil's Forge.\n\n${assignment}${advisory}\n\nReturn only the requested structured output.`;
}
