import type { CheckResult, GateName } from "../workflow/types.ts";

export interface DeterministicGateSummary { gate: GateName; revisionId: string; passed: boolean; results: CheckResult[]; }
export function requiredChecksPassed(results: CheckResult[], requiredIds: string[]): boolean { return requiredIds.every((id) => results.some((result) => result.id === id && result.status === "passed")); }
