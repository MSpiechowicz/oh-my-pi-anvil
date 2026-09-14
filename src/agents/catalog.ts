import { AnvilError } from "../util/errors.ts";
import type { AgentRole, WorkflowConfig } from "../workflow/types.ts";

export interface DiscoveredAgent { name: string; disabled?: boolean; model?: string; }
export class AgentCatalog {
  constructor(private readonly discover: (cwd: string) => Promise<DiscoveredAgent[]>) {}
  async validate(cwd: string, config: WorkflowConfig): Promise<void> { const agents = await this.discover(cwd); const byName = new Map(agents.map((agent) => [agent.name, agent])); const missing: string[] = []; for (const role of ["planner", "implementation", "security", "review"] as AgentRole[]) { const configured = config.agents[role].agent; const found = byName.get(configured); if (!found) missing.push(`${role}=${configured}`); else if (found.disabled) throw new AnvilError("AGENT_DISABLED", `Configured ${role} agent is disabled: ${configured}`); } if (missing.length > 0) throw new AnvilError("AGENT_NOT_FOUND", `Configured agents were not discovered: ${missing.join(", ")}`); }
}
