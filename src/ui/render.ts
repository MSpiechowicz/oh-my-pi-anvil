import type { InitReport } from "../config/init.ts";
import { MODEL_ROLE_ALIASES, ROLE_LABELS, WORKFLOW_ROLE_ORDER } from "../agents/roles.ts";
import { displayState } from "../workflow/state.ts";
import type { RunSummary } from "../workflow/engine.ts";
import type { UpdateReport } from "../update.ts";

export interface ConfigurationLocations {
  globalConfig: string;
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

export function renderConfiguration(locations: ConfigurationLocations): string {
  const projectState = locations.projectConfigPresent ? "present" : "not present";
  const configState = locations.configError ? `INVALID  ${locations.configError}` : "VALID";
  const roleLines = WORKFLOW_ROLE_ORDER.map((role) => `  ${ROLE_LABELS[role].padEnd(11)} @${MODEL_ROLE_ALIASES[role]}`);
  return [
    "ANVIL · CONFIGURATION",
    "",
    `CONFIGURATION     ${configState}`,
    "",
    "GLOBAL LOCATIONS",
    `  Anvil config     ${locations.globalConfig}`,
    `  OMP model maps   ${locations.globalModels}`,
    "",
    "PROJECT LOCATIONS",
    `  Overlay          ${locations.projectConfig} (${projectState})`,
    `  Runtime state    ${locations.runtimeRoot}`,
    "",
    "MODEL ROLES",
    ...roleLines,
    "  Warden       deterministic checks (no model)",
    "",
    "COMMANDS",
    "  /anvil config",
    "  /anvil doctor",
    "  /anvil init",
    "  /anvil update check|install",
    "  /forge <objective>",
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
  const state = report.updated ? "UPDATED" : report.updateAvailable ? "AVAILABLE" : "CURRENT";
  return [
    `ANVIL · UPDATE ${state}`,
    "",
    `INSTALLED   ${report.currentVersion}`,
    `LATEST     ${report.latestVersion ?? "none"}`,
    `MANAGED    ${report.managed ? "OMP marketplace" : "source checkout"}`,
    report.message ?? (report.releaseUrl ? `RELEASE    ${report.releaseUrl}` : "No published stable release available."),
  ].join("\n");
}

export function renderStatus(summary: RunSummary): string {
  const run = summary.run;
  const attempts = summary.attempts.reduce<Record<string, number>>((counts, attempt) => {
    counts[attempt.state] = (counts[attempt.state] ?? 0) + 1;
    return counts;
  }, {});
  const open = summary.findings.filter((finding) => finding.status === "open");
  return [
    `ANVIL · FORGE RUN ${run.id}`,
    "",
    `STATUS       ${run.status.toUpperCase()}`,
    `STAGE        ${displayState(run.currentState).toUpperCase()}`,
    `REVISION     ${run.currentRevisionId}`,
    `EPOCH        ${run.mutationEpoch}`,
    `TRANSITIONS  ${run.transitionCount}`,
    "",
    "ATTEMPTS",
    ...Object.entries(attempts).map(([state, count]) => `  ${(STAGE_LABELS[state] ?? state).padEnd(12)} ${count}`),
    "",
    `OPEN FINDINGS ${open.length}`,
    ...open.slice(0, 8).map((finding) => `  ${finding.id}  ${finding.severity.toUpperCase()}  ${finding.title}`),
    "",
    "USAGE",
    `  ${run.usedTokens.toLocaleString()} tokens · ${run.usedRequests} requests`,
    "",
    `ARTIFACTS    ${run.workspaceRoot}/.omp/.anvil/runs/${run.id}`,
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
