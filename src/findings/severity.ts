import type { FindingSeverity } from "../workflow/types.ts";
const RANK: Record<FindingSeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
export function severityAtOrAbove(value: string, threshold: FindingSeverity): boolean { return (RANK[value as FindingSeverity] ?? 0) >= RANK[threshold]; }
export function isBlockingSeverity(value: string, failOn: FindingSeverity[]): boolean { return failOn.includes(value as FindingSeverity); }
