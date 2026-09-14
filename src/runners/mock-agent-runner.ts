import type { AgentRole, AgentRunRequest, AgentRunResult, AgentRunner } from "../workflow/types.ts";

export type MockResponse = { role: AgentRole; structured?: unknown; status?: AgentRunResult<unknown>["status"]; mutate?: () => void | Promise<void>; error?: { code: string; message: string }; };
export class MockAgentRunner implements AgentRunner {
  private cursor: Record<AgentRole, number> = { planner: 0, implementation: 0, security: 0, review: 0, scout: 0, archivist: 0 };
  constructor(private readonly responses: MockResponse[]) {}
  async run<T>(request: AgentRunRequest): Promise<AgentRunResult<T>> {
    const index = this.cursor[request.role]; const matches = this.responses.filter((response) => response.role === request.role); const response = matches[index]; this.cursor[request.role] = index + 1;
    if (!response) return { status: "failed", agentName: request.agentName, usage: { requests: 1 }, durationMs: 0, error: { code: "MOCK_RESPONSE_EXHAUSTED", message: `No mock response for ${request.role} #${index + 1}` } };
    await response.mutate?.();
    return { status: response.status ?? "completed", agentName: request.agentName, usage: { requests: 1, total: 1 }, durationMs: 1, structured: response.structured as T, error: response.error };
  }
}
