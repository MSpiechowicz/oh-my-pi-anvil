import { hashJson } from "../util/hash.ts";
import type { GateName } from "../workflow/types.ts";

export interface GateCacheInput { gate: GateName; revisionId: string; configHash: string; gatePolicyHash: string; promptVersion: number; schemaVersion: number; agentIdentity?: string; modelIdentity?: string; }
export function gateCacheKey(input: GateCacheInput): string { return hashJson(input.gate === "checks" ? { gate: input.gate, revisionId: input.revisionId, configHash: input.configHash, gatePolicyHash: input.gatePolicyHash } : input); }
