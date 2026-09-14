import { AnvilError } from "../util/errors.ts";
import type { ReviewOutput, SecurityOutput, WorkflowState } from "./types.ts";

const LEGAL: Record<WorkflowState, WorkflowState[]> = {
  INIT: ["PLAN", "FAILED", "CANCELLED"], PLAN: ["IMPLEMENT", "PLAN", "BLOCKED", "FAILED", "CANCELLED"], IMPLEMENT: ["CHECKS", "PLAN", "BLOCKED", "FAILED", "CANCELLED"], CHECKS: ["SECURITY", "IMPLEMENT", "BLOCKED", "FAILED", "CANCELLED"], SECURITY: ["REVIEW", "IMPLEMENT", "CHECKS", "BLOCKED", "FAILED", "CANCELLED"], REVIEW: ["DONE", "IMPLEMENT", "CHECKS", "BLOCKED", "FAILED", "CANCELLED"], DONE: [], BLOCKED: [], FAILED: [], CANCELLED: [],
};

export function assertLegalTransition(from: WorkflowState, to: WorkflowState): void {
  if (!LEGAL[from].includes(to)) throw new AnvilError("INVARIANT_VIOLATION", `Illegal workflow transition ${from} -> ${to}`);
}
export function nextAfterSecurity(result: SecurityOutput, failOn: string[]): WorkflowState {
  if (result.verdict === "blocked") return "BLOCKED";
  return result.verdict === "findings" && result.findings.some((finding) => failOn.includes(finding.severity)) ? "IMPLEMENT" : "REVIEW";
}
export function nextAfterReview(result: ReviewOutput, blockOn: string[]): WorkflowState {
  if (result.verdict === "blocked") return "BLOCKED";
  return result.verdict === "findings" && result.findings.some((finding) => blockOn.includes(finding.severity)) ? "IMPLEMENT" : "DONE";
}
export function legalTransitions(from: WorkflowState): readonly WorkflowState[] { return LEGAL[from]; }
