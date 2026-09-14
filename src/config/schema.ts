import { AnvilError } from "../util/errors.ts";
import type { FindingSeverity, WorkflowConfig } from "../workflow/types.ts";

import { WORKFLOW_ROLE_ORDER as ROLES } from "../agents/roles.ts";
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const TOP_LEVEL_KEYS = ["version", "workflow", "agents", "checks", "checksFailFast", "security", "review", "implementation", "planning", "scouting", "budgets", "context", "memory", "persistence", "safety"] as const;
function rejectUnknownKeys(value: object, allowed: readonly string[], label: string): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new AnvilError("CONFIG_INVALID", `Unknown ${label} key: ${key}`); }

function normalizeTokenLimit(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new AnvilError("CONFIG_INVALID", `${label} must be a positive finite number or null`);
  return value;
}

export function validateConfig(config: WorkflowConfig): WorkflowConfig {
  rejectUnknownKeys(config, TOP_LEVEL_KEYS, "top-level config");
  rejectUnknownKeys(config.workflow, ["name"], "workflow");
  rejectUnknownKeys(config.agents, ROLES, "agents");
  for (const role of ROLES) {
    const agent = config.agents[role];
    rejectUnknownKeys(agent, ["agent", "model", "thinkingLevel", "effort"], `agents.${role}`);
    if (typeof agent.agent !== "string" || !agent.agent.trim()) throw new AnvilError("CONFIG_INVALID", `agents.${role}.agent must be a non-empty string`);
    if (agent.model !== undefined && (typeof agent.model !== "string" || !agent.model.trim())) throw new AnvilError("CONFIG_INVALID", `agents.${role}.model must be a non-empty string`);
    if (agent.thinkingLevel !== undefined && !["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"].includes(agent.thinkingLevel)) throw new AnvilError("CONFIG_INVALID", `Invalid agents.${role}.thinkingLevel`);
  }
  for (const check of config.checks ?? []) rejectUnknownKeys(check, ["id", "command", "cwd", "env", "required", "timeoutMs"], `check ${check.id}`);
  rejectUnknownKeys(config.security, ["failOn", "maxAttempts", "policyVersion"], "security");
  rejectUnknownKeys(config.review, ["maxAttempts", "blockOn", "policyVersion"], "review");
  rejectUnknownKeys(config.implementation, ["maxAttempts", "maxParallel", "isolation"], "implementation");
  if (config.implementation.maxParallel === undefined) config.implementation.maxParallel = 4;
  if (!Number.isInteger(config.implementation.maxParallel) || config.implementation.maxParallel < 1 || config.implementation.maxParallel > 32) throw new AnvilError("CONFIG_INVALID", "implementation.maxParallel must be an integer from 1 to 32");
  rejectUnknownKeys(config.implementation.isolation, ["enabled", "merge"], "implementation.isolation");
  rejectUnknownKeys(config.planning, ["maxGenerations", "maxAttempts"], "planning");
  if (!config.scouting || typeof config.scouting !== "object" || Array.isArray(config.scouting)) throw new AnvilError("CONFIG_INVALID", "scouting must be an object");
  rejectUnknownKeys(config.scouting, ["enabled"], "scouting");
  if (typeof config.scouting.enabled !== "boolean") throw new AnvilError("CONFIG_INVALID", "scouting.enabled must be a boolean");
  rejectUnknownKeys(config.budgets, ["maxTotalTokens", "maxTotalRequests", "maxTransitions", "maxWallClockMs", "perRole"], "budgets");
  rejectUnknownKeys(config.budgets.perRole, ROLES, "budgets.perRole");
  for (const role of ROLES) if (config.budgets.perRole[role]) rejectUnknownKeys(config.budgets.perRole[role]!, ["maxTokens", "maxAttempts", "maxRequests"], `budgets.perRole.${role}`);
  rejectUnknownKeys(config.context, ["maxInlineChars", "maxMemoryItems", "maxMemoryChars", "maxFindingSummaryChars", "maxChangedFiles"], "context");
  rejectUnknownKeys(config.memory, ["enabled", "retainOnSuccess", "archivist", "maxRetainedLessons"], "memory");
  for (const flag of ["enabled", "retainOnSuccess", "archivist"] as const) if (typeof config.memory[flag] !== "boolean") throw new AnvilError("CONFIG_INVALID", `memory.${flag} must be a boolean`);
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
  config.budgets.maxTotalTokens = normalizeTokenLimit(config.budgets.maxTotalTokens, "budgets.maxTotalTokens");
  for (const role of ROLES) {
    const policy = config.budgets.perRole[role];
    if (policy) policy.maxTokens = normalizeTokenLimit(policy.maxTokens, `budgets.perRole.${role}.maxTokens`);
  }
  for (const value of [config.budgets.maxTotalRequests, config.budgets.maxTransitions, config.budgets.maxWallClockMs]) if (value !== undefined && value <= 0) throw new AnvilError("CONFIG_INVALID", "Budget limits must be positive");
  if (config.context.maxInlineChars <= 0 || config.context.maxChangedFiles <= 0) throw new AnvilError("CONFIG_INVALID", "Context limits must be positive");
  return config;
}

export function isSeverity(value: string): value is FindingSeverity { return (SEVERITIES as readonly string[]).includes(value); }
