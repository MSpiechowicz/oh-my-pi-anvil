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
    "/forge [--clarify=auto|always|off] <objective>",
    "/forge help",
    "",
    "Clarification defaults to auto: inspect the repository and ask only about material decisions.",
    "Always confirms a brief; off executes the supplied objective directly.",
    "Without interactive input, unresolved decisions stop before execution.",
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

const FORGE_INK = {
  gold: "231;185;102",
  text: "232;228;218",
  muted: "151;153;160",
  blue: "115;190;245",
  ember: "255;151;92",
  green: "128;211;163",
  violet: "195;156;239",
  cyan: "108;215;225",
  ivory: "239;229;207",
  red: "245;123;123",
} as const;

export function renderStatus(summary: RunSummary, color = false): string {
  const { run } = summary;
  const ink = (tone: keyof typeof FORGE_INK, text: string, bold = false): string =>
    color ? `\x1b[${bold ? "1;" : ""}38;2;${FORGE_INK[tone]}m${text}\x1b[0m` : text;
  const heading = (text: string): string => ink("gold", `  ━━ ${text} ${"━".repeat(Math.max(0, 48 - text.length))}`);
  const row = (label: string, value: string): string => `  ${ink("muted", label.padEnd(14))}${ink("text", value)}`;
  const number = (value: number | undefined): string => value?.toLocaleString() ?? "unknown";
  const attempts = summary.attempts.reduce<Record<string, number>>((counts, attempt) => {
    const label = attempt.role ? ROLE_LABELS[attempt.role] : STAGE_LABELS[attempt.state] ?? attempt.state;
    counts[label] = (counts[label] ?? 0) + 1;
    return counts;
  }, {});
  const open = summary.findings.filter((finding) => finding.status === "open");
  const sealed = run.status === "done";
  const tone = sealed ? "green" : run.status === "running" ? "gold" : "red";
  const verdict = sealed ? "FORGE SUCCESS" : `FORGE ${run.status.toUpperCase()}`;
  const roles = [
    [ROLE_LABELS.scout, "cyan"], [ROLE_LABELS.planner, "blue"],
    [ROLE_LABELS.implementation, "ember"], ["Warden", "gold"],
    [ROLE_LABELS.security, "green"], [ROLE_LABELS.review, "violet"],
    [ROLE_LABELS.archivist, "ivory"],
  ] as const;
  const peak = Math.max(1, ...Object.values(attempts));
  const roleRow = (label: string, count: number, roleTone: keyof typeof FORGE_INK): string => {
    const bars = count ? Math.max(1, Math.round(count / peak * 12)) : 0;
    return `  ${ink(roleTone, label.padEnd(14))}${
      ink(roleTone, "━".repeat(bars))
    }${ink("muted", "·".repeat(12 - bars))}  ${ink("text", String(count).padStart(3), true)} ${ink("muted", count === 1 ? "attempt" : "attempts")}`;
  };
  return [
    "",
    ink("gold", `  ${"━".repeat(52)}`),
    `  ${ink("gold", "A N V I L", true)}`,
    `  ${ink(tone, verdict, true)}`,
    ...(run.status === "running" ? [`  ${ink("muted", `STAGE / ${displayState(run.currentState).toUpperCase()}`)}`] : []),
    ink("gold", `  ${"━".repeat(52)}`),
    "",
    `  ${ink(open.length ? "red" : "green", `${open.length} OPEN FINDINGS`, true)}  ${ink("muted", " / ")}  ${
      ink("text", `${run.transitionCount} transitions`, true)
    }  ${ink("muted", ` /  epoch ${run.mutationEpoch}`)}`,
    ...(run.failureCode || run.failureMessage || run.blockedReason
      ? ["", ...(run.failureCode ? [`  ${ink("red", run.failureCode, true)}`] : []),
        `  ${ink("text", run.failureMessage ?? run.blockedReason ?? "No details recorded")}`]
      : []),
    ...open.slice(0, 8).map((finding) =>
      `  ${ink("red", finding.severity.toUpperCase(), true)} ${ink("text", finding.title)} ${ink("muted", `[${finding.id}]`)}`),
    ...(open.length > 8 ? [`  ${ink("muted", `+ ${open.length - 8} more · /anvil findings ${run.id}`)}`] : []),
    "",
    heading("THE FORGE CREW"),
    ...roles.map(([label, roleTone]) => roleRow(label, attempts[label] ?? 0, roleTone)),
    ...Object.entries(attempts).filter(([label]) => !roles.some(([role]) => role === label))
      .map(([label, count]) => roleRow(label, count, "muted")),
    "",
    heading("TOKEN LEDGER"),
    `  ${ink("gold", `${number(run.usedTokens)} tokens`, true)}  ${ink("muted", "/")}  ${
      ink("text", `${number(run.usedRequests)} requests`, true)
    }`,
    row("LIMIT", run.maxTotalTokens === undefined ? "No token limit" : `${number(run.maxTotalTokens)} tokens`),
    row("INPUT", number(run.usedInputTokens)),
    row("OUTPUT", number(run.usedOutputTokens)),
    row("CACHE READ", number(run.usedCacheReadTokens)),
    row("CACHE WRITE", number(run.usedCacheWriteTokens)),
    "",
    ink("muted", "  Host aggregate; cache included when reported. Otherwise input + output."),
    ink("muted", "  Not monetary cost. Components may be incomplete or not sum to total;"),
    ink("muted", "  zero can mean unreported. Caps checked between stages, not mid-child."),
    "",
    heading("RUN RECORD"),
    row("RUN", run.id),
    row("REVISION", run.currentRevisionId),
    row("ARTIFACTS", `${run.workspaceRoot}/.anvil/runs/${run.id}`),
    "",
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
