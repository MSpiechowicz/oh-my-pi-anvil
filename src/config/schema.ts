import { AnvilError } from "../util/errors.ts";
import type { FindingSeverity, WorkflowConfig } from "../workflow/types.ts";

import { WORKFLOW_ROLE_ORDER as ROLES } from "../agents/roles.ts";
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const TOP_LEVEL_KEYS = ["version", "workflow", "agents", "checks", "checksFailFast", "security", "review", "implementation", "planning", "clarification", "scouting", "budgets", "context", "memory", "persistence", "safety"] as const;
function rejectUnknownKeys(value: object, allowed: readonly string[], label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AnvilError("CONFIG_INVALID", `${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    if (key === "maxAttempts" && ["planning", "implementation", "security", "review"].includes(label)) {
      const role = label === "planning" ? "planner" : label;
      throw new AnvilError("CONFIG_INVALID", `${label}.maxAttempts is obsolete; move it to budgets.perRole.${role}.maxAttempts (null means unlimited)`);
    }
    throw new AnvilError("CONFIG_INVALID", `Unknown ${label} key: ${key}`);
  }
}

function normalizeLimit(value: unknown, label: string, integer = false): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) throw new AnvilError("CONFIG_INVALID", `${label} must be a positive finite ${integer ? "integer" : "number"} or null`);
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
    agent.model ??= null;
    agent.thinkingLevel ??= null;
    agent.effort ??= null;
    if (agent.model != null && (typeof agent.model !== "string" || !agent.model.trim())) throw new AnvilError("CONFIG_INVALID", `agents.${role}.model must be a non-empty string or null`);
    if (agent.thinkingLevel != null && !["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"].includes(agent.thinkingLevel)) throw new AnvilError("CONFIG_INVALID", `Invalid agents.${role}.thinkingLevel`);
    if (agent.effort != null && (typeof agent.effort !== "string" || !agent.effort.trim())) throw new AnvilError("CONFIG_INVALID", `agents.${role}.effort must be a non-empty string or null`);
  }
  for (const check of config.checks ?? []) rejectUnknownKeys(check, ["id", "command", "cwd", "env", "required", "timeoutMs"], `check ${check.id}`);
  rejectUnknownKeys(config.security, ["failOn", "policyVersion"], "security");
  rejectUnknownKeys(config.review, ["blockOn", "policyVersion"], "review");
  rejectUnknownKeys(config.implementation, ["maxParallel", "isolation"], "implementation");
  if (config.implementation.maxParallel === undefined) config.implementation.maxParallel = 4;
  if (!Number.isInteger(config.implementation.maxParallel) || config.implementation.maxParallel < 1 || config.implementation.maxParallel > 32) throw new AnvilError("CONFIG_INVALID", "implementation.maxParallel must be an integer from 1 to 32");
  rejectUnknownKeys(config.implementation.isolation, ["enabled", "merge"], "implementation.isolation");
  rejectUnknownKeys(config.planning, ["maxGenerations"], "planning");
  config.planning.maxGenerations = normalizeLimit(config.planning.maxGenerations, "planning.maxGenerations", true);
  rejectUnknownKeys(config.clarification, ["mode", "maxRounds"], "clarification");
  if (!["auto", "always", "off"].includes(config.clarification.mode)) throw new AnvilError("CONFIG_INVALID", "clarification.mode must be auto, always, or off");
  if (!Number.isInteger(config.clarification.maxRounds) || config.clarification.maxRounds < 1 || config.clarification.maxRounds > 10) throw new AnvilError("CONFIG_INVALID", "clarification.maxRounds must be an integer from 1 to 10");
  if (!config.scouting || typeof config.scouting !== "object" || Array.isArray(config.scouting)) throw new AnvilError("CONFIG_INVALID", "scouting must be an object");
  rejectUnknownKeys(config.scouting, ["enabled"], "scouting");
  if (typeof config.scouting.enabled !== "boolean") throw new AnvilError("CONFIG_INVALID", "scouting.enabled must be a boolean");
  rejectUnknownKeys(config.budgets, ["maxTotalTokens", "maxTotalRequests", "maxTransitions", "maxWallClockMs", "perRole"], "budgets");
  rejectUnknownKeys(config.budgets.perRole, ROLES, "budgets.perRole");
  for (const role of ROLES) {
    const policy = config.budgets.perRole[role] === undefined ? (config.budgets.perRole[role] = {}) : config.budgets.perRole[role]!;
    rejectUnknownKeys(policy, ["maxTokens", "maxAttempts", "maxRequests"], `budgets.perRole.${role}`);
    policy.maxTokens = normalizeLimit(policy.maxTokens, `budgets.perRole.${role}.maxTokens`);
    policy.maxAttempts = normalizeLimit(policy.maxAttempts, `budgets.perRole.${role}.maxAttempts`, true);
    policy.maxRequests = normalizeLimit(policy.maxRequests, `budgets.perRole.${role}.maxRequests`, true);
  }
  rejectUnknownKeys(config.context, ["maxInlineChars", "maxMemoryItems", "maxMemoryChars", "maxFindingSummaryChars", "maxChangedFiles"], "context");
  rejectUnknownKeys(config.memory, ["enabled", "retainOnSuccess", "archivist", "maxRetainedLessons"], "memory");
  for (const flag of ["enabled", "retainOnSuccess", "archivist"] as const) if (typeof config.memory[flag] !== "boolean") throw new AnvilError("CONFIG_INVALID", `memory.${flag} must be a boolean`);
  rejectUnknownKeys(config.persistence, ["root", "keepAgentRawArtifacts", "keepCommandLogs", "persistRenderedPrompts"], "persistence");
  rejectUnknownKeys(config.safety, ["oneMutatingRunPerWorkspace", "securityMustBeReadOnly", "reviewerMustBeReadOnly", "refusePathEscapeFromWorkspace"], "safety");
  const ids = new Set<string>();
  for (const check of config.checks ?? []) {
    if (!check.id || ids.has(check.id)) throw new AnvilError("CONFIG_INVALID", `Duplicate or empty check id: ${check.id}`);
    if (!Array.isArray(check.command) || check.command.length === 0) throw new AnvilError("CONFIG_INVALID", `Check ${check.id} needs an argv command`);
    check.timeoutMs = normalizeLimit(check.timeoutMs, `Check ${check.id} timeoutMs`);
    check.cwd ??= null;
    check.env ??= null;
    if (check.cwd != null && (typeof check.cwd !== "string" || !check.cwd.trim())) throw new AnvilError("CONFIG_INVALID", `Check ${check.id} cwd must be a non-empty string or null`);
    if (check.env != null && (typeof check.env !== "object" || Array.isArray(check.env) || Object.values(check.env).some((value) => typeof value !== "string"))) throw new AnvilError("CONFIG_INVALID", `Check ${check.id} env must contain string values or be null`);
    ids.add(check.id);
  }
  const severities = new Set<string>(SEVERITIES);
  for (const severity of config.security.failOn) if (!severities.has(severity)) throw new AnvilError("CONFIG_INVALID", `Unknown security severity ${severity}`);
  config.budgets.maxTotalTokens = normalizeLimit(config.budgets.maxTotalTokens, "budgets.maxTotalTokens");
  config.budgets.maxTotalRequests = normalizeLimit(config.budgets.maxTotalRequests, "budgets.maxTotalRequests", true);
  config.budgets.maxTransitions = normalizeLimit(config.budgets.maxTransitions, "budgets.maxTransitions", true);
  config.budgets.maxWallClockMs = normalizeLimit(config.budgets.maxWallClockMs, "budgets.maxWallClockMs");
  if (config.context.maxInlineChars <= 0 || config.context.maxChangedFiles <= 0) throw new AnvilError("CONFIG_INVALID", "Context limits must be positive");
  return config;
}

export function isSeverity(value: string): value is FindingSeverity { return (SEVERITIES as readonly string[]).includes(value); }
