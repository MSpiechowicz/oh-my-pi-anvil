import type { AgentRole } from "../workflow/types.ts";

export const DEFAULT_AGENT_POLICY: Record<AgentRole, { readOnly: boolean; canSpawnWorkers: boolean }> = {
  planner: { readOnly: true, canSpawnWorkers: false },
  implementation: { readOnly: false, canSpawnWorkers: false },
  security: { readOnly: true, canSpawnWorkers: false },
  review: { readOnly: true, canSpawnWorkers: false },
};
