import type { AgentRunRequest, AgentRunResult } from "../workflow/types.ts";

export interface OmpCompat { discoverAgents?: (cwd: string) => Promise<Array<{ name: string; disabled?: boolean }>>; execute?: <T>(request: AgentRunRequest) => Promise<AgentRunResult<T>>; }
export function createOmpCompat(context: unknown): OmpCompat { const candidate = context as { discoverAgents?: OmpCompat["discoverAgents"]; runSubprocess?: OmpCompat["execute"] }; return { discoverAgents: candidate.discoverAgents, execute: candidate.runSubprocess }; }
