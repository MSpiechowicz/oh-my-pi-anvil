import { AnvilError } from "../util/errors.ts";
import type { AgentRunRequest, AgentRunResult, AgentRunner } from "../workflow/types.ts";
import type { OmpCompat } from "./omp-compat.ts";

export class OmpSubprocessRunner implements AgentRunner {
  constructor(private readonly compat: OmpCompat) {}
  async validate(cwd: string, names: string[]): Promise<void> { if (!this.compat.discoverAgents) return; const discovered = await this.compat.discoverAgents(cwd); const namesByValue = new Set(discovered.filter((agent) => !agent.disabled).map((agent) => agent.name)); const missing = names.filter((name) => !namesByValue.has(name)); if (missing.length > 0) throw new AnvilError("AGENT_NOT_FOUND", `Configured agents were not discovered: ${missing.join(", ")}`); }
  async run<T>(request: AgentRunRequest): Promise<AgentRunResult<T>> { if (!this.compat.execute) return { status: "failed", agentName: request.agentName, usage: { requests: 0 }, durationMs: 0, error: { code: "OMP_EXECUTOR_UNAVAILABLE", message: "No OMP child-agent executor is available in this extension context" } }; return this.compat.execute<T>(request); }
}
