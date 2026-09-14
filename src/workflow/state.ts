import type { RunRecord, RunStatus, WorkflowState } from "./types.ts";

export const STATE_LABELS: Record<WorkflowState, string> = {
  INIT: "Initializing", PLAN: "Architect", IMPLEMENT: "Smith", CHECKS: "Warden", SECURITY: "Sentinel", REVIEW: "Inquisitor", DONE: "Sealed", BLOCKED: "Blocked", FAILED: "Failed", CANCELLED: "Cancelled",
};

export const TERMINAL_STATES = new Set<WorkflowState>(["DONE", "FAILED", "CANCELLED"]);
export const ACTIVE_STATES = new Set<WorkflowState>(["PLAN", "IMPLEMENT", "CHECKS", "SECURITY", "REVIEW"]);
export const isTerminal = (state: WorkflowState): boolean => TERMINAL_STATES.has(state);
export const statusForState = (state: WorkflowState): RunStatus => state === "DONE" ? "done" : state === "BLOCKED" ? "blocked" : state === "FAILED" ? "failed" : state === "CANCELLED" ? "cancelled" : "running";
export function displayState(state: WorkflowState): string { return STATE_LABELS[state]; }
export function assertActive(run: RunRecord): void { if (isTerminal(run.currentState) || run.currentState === "BLOCKED") throw new Error(`Run ${run.id} is already ${run.currentState}`); }
