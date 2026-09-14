import type { ReviewOutput } from "../workflow/types.ts";
export function reviewBlocks(output: ReviewOutput, blockOn: ReviewOutput["findings"][number]["severity"][]): boolean { return output.verdict === "blocked" || output.findings.some((finding) => blockOn.includes(finding.severity)); }
