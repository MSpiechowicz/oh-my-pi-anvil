import { AnvilError } from "../util/errors.ts";
import type { FindingSeverity, WorkflowConfig } from "../workflow/types.ts";

const ROLES = ["planner", "implementation", "security", "review"] as const;
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const TOP_LEVEL_KEYS = ["version", "workflow", "agents", "checks", "checksFailFast", "security", "review", "implementation", "planning", "budgets", "context", "memory", "persistence", "safety"] as const;
function rejectUnknownKeys(value: object, allowed: readonly string[], label: string): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new AnvilError("CONFIG_INVALID", `Unknown ${label} key: ${key}`); }

export function validateConfig(config: WorkflowConfig): WorkflowConfig {
  rejectUnknownKeys(config, TOP_LEVEL_KEYS, "top-level config");
  rejectUnknownKeys(config.workflow, ["name"], "workflow");
  for (const role of ROLES) rejectUnknownKeys(config.agents[role], ["agent", "model", "effort"], `agents.${role}`);
  for (const check of config.checks ?? []) rejectUnknownKeys(check, ["id", "command", "cwd", "env", "required", "timeoutMs"], `check ${check.id}`);
  rejectUnknownKeys(config.security, ["failOn", "maxAttempts", "policyVersion"], "security");
  rejectUnknownKeys(config.review, ["maxAttempts", "blockOn", "policyVersion"], "review");
  rejectUnknownKeys(config.implementation, ["maxAttempts", "isolation"], "implementation");
  rejectUnknownKeys(config.implementation.isolation, ["enabled", "merge"], "implementation.isolation");
  rejectUnknownKeys(config.planning, ["maxGenerations", "maxAttempts"], "planning");
  rejectUnknownKeys(config.budgets, ["maxTotalTokens", "maxTotalRequests", "maxTransitions", "maxWallClockMs", "perRole"], "budgets");
  for (const role of ROLES) if (config.budgets.perRole[role]) rejectUnknownKeys(config.budgets.perRole[role]!, ["maxTokens", "maxAttempts", "maxRequests"], `budgets.perRole.${role}`);
  rejectUnknownKeys(config.context, ["maxInlineChars", "maxMemoryItems", "maxMemoryChars", "maxFindingSummaryChars", "maxChangedFiles"], "context");
  rejectUnknownKeys(config.memory, ["enabled", "retainOnSuccess", "maxRetainedLessons"], "memory");
  rejectUnknownKeys(config.persistence, ["root", "keepAgentRawArtifacts", "keepCommandLogs", "persistRenderedPrompts"], "persistence");
  rejectUnknownKeys(config.safety, ["oneMutatingRunPerWorkspace", "securityMustBeReadOnly", "reviewerMustBeReadOnly", "refusePathEscapeFromWorkspace"], "safety");
  const ids = new Set<string>();
  for (const check of config.checks ?? []) {
    if (!check.id || ids.has(check.id)) throw new AnvilError("CONFIG_INVALID", `Duplicate or empty check id: ${check.id}`);
    if (!Array.isArray(check.command) || check.command.length === 0) throw new AnvilError("CONFIG_INVALID", `Check ${check.id} needs an argv command`);
    if (check.timeoutMs <= 0) throw new AnvilError("CONFIG_INVALID", `Check ${check.id} timeout must be positive`);
    ids.add(check.id);
  }
  const severities = new Set<string>(SEVERITIES);
  for (const severity of config.security.failOn) if (!severities.has(severity)) throw new AnvilError("CONFIG_INVALID", `Unknown security severity ${severity}`);
  if (config.implementation.maxAttempts <= 0 || config.security.maxAttempts <= 0 || config.review.maxAttempts <= 0 || config.planning.maxAttempts <= 0) throw new AnvilError("CONFIG_INVALID", "Attempt limits must be positive");
  for (const value of [config.budgets.maxTotalTokens, config.budgets.maxTotalRequests, config.budgets.maxTransitions, config.budgets.maxWallClockMs]) if (value !== undefined && value <= 0) throw new AnvilError("CONFIG_INVALID", "Budget limits must be positive");
  if (config.context.maxInlineChars <= 0 || config.context.maxChangedFiles <= 0) throw new AnvilError("CONFIG_INVALID", "Context limits must be positive");
  return config;
}

export function isSeverity(value: string): value is FindingSeverity { return (SEVERITIES as readonly string[]).includes(value); }
