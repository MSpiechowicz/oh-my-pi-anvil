import { hashJson } from "../util/hash.ts";
import { stableJson } from "../util/json.ts";
import type { GateName } from "../workflow/types.ts";

export interface FindingFingerprintInput { sourceGate: GateName; category: string; file?: string; symbol?: string; title: string; }
export function normalizeFindingInput(input: FindingFingerprintInput): FindingFingerprintInput { return { sourceGate: input.sourceGate, category: input.category.trim().toLowerCase(), file: input.file?.replaceAll("\\", "/").trim().toLowerCase(), symbol: input.symbol?.trim().toLowerCase(), title: input.title.replace(/\bline\s+\d+\b/gi, "line").replace(/\s+/g, " ").replace(/[.!,;:]+$/g, "").trim().toLowerCase() }; }
export function findingFingerprint(input: FindingFingerprintInput): string { return hashJson(JSON.parse(stableJson(normalizeFindingInput(input)))); }
