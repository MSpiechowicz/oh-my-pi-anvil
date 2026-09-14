import type { AgentRunRequest, AgentRunResult, AgentRunner } from "../workflow/types.ts";

export interface StructuredSubagentExecutor { run<T>(request: AgentRunRequest): Promise<AgentRunResult<T>>; }
export class StructuredSubagentRunner implements AgentRunner {
  constructor(private readonly executor: StructuredSubagentExecutor) {}
  run<T>(request: AgentRunRequest): Promise<AgentRunResult<T>> { return this.executor.run<T>(request); }
}
