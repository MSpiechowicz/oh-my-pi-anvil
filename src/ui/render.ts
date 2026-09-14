import type { InitReport } from "../config/init.ts";
import { MODEL_ROLE_ALIASES, ROLE_LABELS, WORKFLOW_ROLE_ORDER } from "../agents/roles.ts";
import { displayState } from "../workflow/state.ts";
import type { RunSummary } from "../workflow/engine.ts";
import type { UpdateReport } from "../update.ts";

export interface ConfigurationLocations {
  globalConfig: string;
  globalConfigPresent: boolean;
  globalModels: string;
  projectConfig: string;
  projectConfigPresent: boolean;
  runtimeRoot: string;
  configError?: string;
}

const STAGE_LABELS: Record<string, string> = {
  INIT: "Initializing",
  PLAN: "Architect",
  IMPLEMENT: "Smith",
  CHECKS: "Warden",
  SECURITY: "Sentinel",
  REVIEW: "Inquisitor",
};

export function renderForgeHelp(): string {
  return [
    "ANVIL · FORGE",
    "",
    "Run the bounded Architect → Smith → Warden → Sentinel → Inquisitor workflow.",
    "",
    "/forge <objective>",
    "/forge help",
    "",
    "Inspect runs and manage configuration with /anvil.",
    "",
    "/anvil config",
    "/anvil doctor",
    "/anvil init",
    "/anvil update check|install",
    "/anvil status [run-id]",
    "/anvil resume <run-id>",
    "/anvil findings [run-id]",
    "/anvil cancel <run-id>",
    "",
  ].join("\n");
}

export function renderAnvilHelp(): string {
  return [
    "ANVIL · MANAGEMENT",
    "",
    "Inspect configuration, manage runs, and update Anvil.",
    "",
    "/anvil config",
    "/anvil doctor",
    "/anvil init",
    "/anvil status [run-id]",
    "/anvil resume <run-id>",
    "/anvil cancel <run-id>",
    "/anvil findings [run-id]",
    "/anvil update check",
    "/anvil update install",
    "/anvil help",
    "",
    "Run a workflow with /forge <objective>.",
  ].join("\n");
}

export const renderHelp = renderForgeHelp;

const CONFIGURATION_LABEL_WIDTH = 16;

function configurationRow(label: string, value: string): string {
  return `  ${label.padEnd(CONFIGURATION_LABEL_WIDTH)}${value}`;
}

export function renderConfiguration(locations: ConfigurationLocations): string {
  const globalState = locations.globalConfigPresent ? "present" : "not present";
  const projectState = locations.projectConfigPresent ? "present" : "not present";
  const configState = locations.configError ? `INVALID  ${locations.configError}` : "VALID";
  return [
    "ANVIL · CONFIGURATION",
    "",
    configurationRow("STATUS", configState),
    "",
    "GLOBAL LOCATIONS",
    configurationRow("Anvil config", `${locations.globalConfig} (${globalState})`),
    configurationRow("OMP model maps", locations.globalModels),
    "",
    "PROJECT LOCATIONS",
    configurationRow("Overlay", `${locations.projectConfig} (${projectState})`),
    configurationRow("Runtime state", locations.runtimeRoot),
    "",
    "MODEL ROLES",
    ...WORKFLOW_ROLE_ORDER.map((role) => configurationRow(ROLE_LABELS[role], `@${MODEL_ROLE_ALIASES[role]}`)),
    configurationRow("Warden", "deterministic checks (no model)"),
    "",
    "COMMANDS",
    ...["/anvil config", "/anvil doctor", "/anvil init", "/anvil update check|install", "/forge <objective>"].map((command) => `  ${command}`),
  ].join("\n");
}

export function renderDoctor(locations: ConfigurationLocations): string {
  return [
    "ANVIL · DOCTOR",
    "",
    locations.configError ? `CONFIGURATION  INVALID  ${locations.configError}` : "CONFIGURATION  VALID",
    "RUNTIME        AVAILABLE",
    "AGENTS         AVAILABLE",
    "",
    `GLOBAL CONFIG  ${locations.globalConfig}`,
    `MODEL MAPPINGS ${locations.globalModels}`,
    `RUNTIME STATE  ${locations.runtimeRoot}`,
  ].join("\n");
}

export function renderInit(report: InitReport): string {
  return [
    "ANVIL · INITIALIZE",
    "",
    "CONFIGURATION FILES",
    `GLOBAL       ${report.global.status.toUpperCase()}  ${report.global.path}`,
    report.project ? `PROJECT      ${report.project.status.toUpperCase()}  ${report.project.path}` : "PROJECT      NOT CREATED  (no repository root found)",
    report.repositoryRoot ? `REPOSITORY   ${report.repositoryRoot}` : "REPOSITORY   NOT FOUND",
    "",
    "CREATED",
    ...(report.created.length > 0 ? report.created.map((filePath) => `  ${filePath}`) : ["  none"]),
    "",
    "ALREADY EXISTING",
    ...(report.existing.length > 0 ? report.existing.map((filePath) => `  ${filePath}`) : ["  none"]),
    "",
    "Initialization is non-destructive: existing settings were left unchanged.",
  ].join("\n");
}

export function renderUpdate(report: UpdateReport): string {
  if (report.updated) return report.message ?? `Updated to ${report.currentVersion} using OMP plugin upgrade. Restart OMP to load the updated extension.`;
  if (report.updateAvailable) return `Anvil ${report.currentVersion}: Newer release available. Run /anvil update install to update it.`;
  if (report.message) return `Anvil ${report.currentVersion}: ${report.message}`;
  return `Anvil ${report.currentVersion}: No newer release available.`;
}

const STATUS_LABEL_WIDTH = 14;

function statusRow(label: string, value: string): string {
  return `  ${label.padEnd(STATUS_LABEL_WIDTH)}${value}`;
}

export function renderStatus(summary: RunSummary): string {
  const run = summary.run;
  const attempts = summary.attempts.reduce<Record<string, number>>((counts, attempt) => {
    counts[attempt.state] = (counts[attempt.state] ?? 0) + 1;
    return counts;
  }, {});
  const open = summary.findings.filter((finding) => finding.status === "open");
  const failure = run.failureCode || run.failureMessage || run.blockedReason
    ? [
        "",
        statusRow("FAILURE", run.failureCode ?? run.status.toUpperCase()),
        statusRow("REASON", run.failureMessage ?? run.blockedReason ?? "No details recorded"),
      ]
    : [];
  return [
    `ANVIL · FORGE RUN ${run.id}`,
    "",
    statusRow("STATUS", run.status.toUpperCase()),
    statusRow("STAGE", displayState(run.currentState).toUpperCase()),
    statusRow("REVISION", run.currentRevisionId),
    statusRow("EPOCH", String(run.mutationEpoch)),
    statusRow("TRANSITIONS", String(run.transitionCount)),
    ...failure,
    "",
    "ATTEMPTS",
    ...Object.entries(attempts).map(([state, count]) => statusRow(STAGE_LABELS[state] ?? state, String(count))),
    "",
    statusRow("FINDINGS", String(open.length)),
    ...open.slice(0, 8).map((finding) => `    ${finding.id}  ${finding.severity.toUpperCase()}  ${finding.title}`),
    "",
    statusRow("USAGE", `${run.usedTokens.toLocaleString()} tokens consumed / ${run.maxTotalTokens === undefined ? "no token limit" : `${run.maxTotalTokens.toLocaleString()} token limit`} · ${run.usedRequests} requests`),
    statusRow("TOKEN BASIS", "Executor-reported aggregate, including cache when the host includes it; input + output fallback if no total is reported. Not monetary cost."),
    statusRow("INPUT", `${run.usedInputTokens?.toLocaleString() ?? "unknown"} tokens recorded`),
    statusRow("OUTPUT", `${run.usedOutputTokens?.toLocaleString() ?? "unknown"} tokens recorded`),
    statusRow("CACHE-READ", `${run.usedCacheReadTokens?.toLocaleString() ?? "unknown"} tokens recorded`),
    statusRow("CACHE-WRITE", `${run.usedCacheWriteTokens?.toLocaleString() ?? "unknown"} tokens recorded`),
    statusRow("REPORTING", "Components may be incomplete; zero can mean unreported. They need not sum to the aggregate."),
    statusRow("LIMIT CHECK", "Between stages; an in-flight child is not interrupted by token caps."),
    statusRow("ARTIFACTS", `${run.workspaceRoot}/.omp/.anvil/runs/${run.id}`),
  ].join("\n");
}

export function renderFindings(summary: RunSummary): string {
  if (summary.findings.length === 0) return "ANVIL · NO FINDINGS\n\nThe Forge has no recorded findings for this run.";
  return [
    "ANVIL · FINDINGS",
    "",
    ...summary.findings.map((finding) => `${finding.id}  ${finding.status.toUpperCase()}  ${finding.severity.toUpperCase()}\n${finding.title}\n${finding.description}`),
  ].join("\n\n");
}
