import type { FindingSeverity, SecurityOutput } from "../workflow/types.ts";
export function securityBlocks(output: SecurityOutput, failOn: FindingSeverity[]): boolean { return output.verdict === "blocked" || output.findings.some((finding) => failOn.includes(finding.severity)); }
