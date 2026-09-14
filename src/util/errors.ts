export type ErrorCode =
  | "CONFIG_INVALID"
  | "AGENT_NOT_FOUND"
  | "AGENT_DISABLED"
  | "MODEL_UNAVAILABLE"
  | "RUN_LOCKED"
  | "RUN_NOT_FOUND"
  | "RUN_ALREADY_TERMINAL"
  | "WORKSPACE_NOT_GIT"
  | "WORKSPACE_REVISION_MISMATCH"
  | "READ_ONLY_GATE_MUTATED_WORKSPACE"
  | "SCHEMA_INVALID"
  | "AGENT_EXECUTION_FAILED"
  | "CHECK_EXECUTION_FAILED"
  | "CHECK_TIMEOUT"
  | "BUDGET_EXHAUSTED"
  | "MAX_ATTEMPTS_EXCEEDED"
  | "NO_PROGRESS"
  | "ARTIFACT_CORRUPT"
  | "PERSISTENCE_ERROR"
  | "CANCELLED"
  | "INVARIANT_VIOLATION";

export class AnvilError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string, cause?: unknown) { super(message, { cause }); this.code = code; this.name = `AnvilError(${code})`; }
}

export function asAnvilError(error: unknown, fallback: ErrorCode = "PERSISTENCE_ERROR"): AnvilError {
  return error instanceof AnvilError ? error : new AnvilError(fallback, error instanceof Error ? error.message : String(error), error);
}
