import type { InitReport } from "../config/init.ts";
import { displayState } from "../workflow/state.ts";
import type { RunSummary } from "../workflow/engine.ts";
import type { UpdateReport } from "../update.ts";

export function renderHelp(): string { return ["ANVIL · THE FORGE", "", "Forge reliable software with specialized AI agents.", "", "/forge init", "/forge start <objective>", "/forge status [run-id]", "/forge resume <run-id>", "/forge cancel <run-id>", "/forge findings [run-id]", "/forge update check|install", "/forge doctor", "/forge help", "", "Compatibility alias: /orchestrate"].join("\n"); }
export function renderInit(report: InitReport): string {
  const alternateSettings = report.detectedAlternates.length > 0 ? report.detectedAlternates : report.alternates;
  return [
    "ANVIL · INITIALIZE",
    "",
    "CONFIGURATION FILES",
    `GLOBAL       ${report.global.status.toUpperCase()}  ${report.global.path}`,
    report.project ? `PROJECT      ${report.project.status.toUpperCase()}  ${report.project.path}` : report.repositoryRoot ? "PROJECT      NOT CREATED  (alternate settings detected)" : "PROJECT      NOT CREATED  (no repository root found)",
    report.repositoryRoot ? `REPOSITORY   ${report.repositoryRoot}` : "REPOSITORY   NOT FOUND",
    "",
    "CREATED",
    ...(report.created.length > 0 ? report.created.map((filePath) => `  ${filePath}`) : ["  none"]),
    "",
    "ALREADY EXISTING",
    ...(report.existing.length > 0 ? report.existing.map((filePath) => `  ${filePath}`) : ["  none"]),
    "",
    "ALTERNATE REPOSITORY SETTINGS",
    ...(alternateSettings.length > 0
      ? ["  detected (preserved; not overwritten)", ...alternateSettings.map((filePath) => `  ${filePath}`)]
      : ["  none detected"]),
    "",
    "Initialization is non-destructive: existing settings were left unchanged.",
  ].join("\n");
}
export function renderUpdate(report: UpdateReport): string { const state = report.updated ? "UPDATED" : report.updateAvailable ? "AVAILABLE" : "CURRENT"; return [`ANVIL · UPDATE ${state}`, "", `INSTALLED   ${report.currentVersion}`, `LATEST     ${report.latestVersion ?? "none"}`, `MANAGED    ${report.managed ? "OMP marketplace" : "source checkout"}`, report.message ?? (report.releaseUrl ? `RELEASE    ${report.releaseUrl}` : "No published stable release available.")].join("\n"); }
export function renderStatus(summary: RunSummary): string { const run = summary.run; const attempts = summary.attempts.reduce<Record<string, number>>((counts, attempt) => { counts[attempt.state] = (counts[attempt.state] ?? 0) + 1; return counts; }, {}); const open = summary.findings.filter((finding) => finding.status === "open"); return [`ANVIL · FORGE RUN ${run.id}`, "", `STATUS       ${run.status.toUpperCase()}`, `STATE        ${displayState(run.currentState).toUpperCase()} · ${run.currentState}`, `REVISION     ${run.currentRevisionId}`, `EPOCH        ${run.mutationEpoch}`, `TRANSITIONS  ${run.transitionCount}`, "", "ATTEMPTS", ...Object.entries(attempts).map(([state, count]) => `  ${state.padEnd(12)} ${count}`), "", `OPEN FINDINGS ${open.length}`, ...open.slice(0, 8).map((finding) => `  ${finding.id}  ${finding.severity.toUpperCase()}  ${finding.title}`), "", "USAGE", `  ${run.usedTokens.toLocaleString()} tokens · ${run.usedRequests} requests`, "", `ARTIFACTS    ${run.workspaceRoot}/.omp/.orchestrator/runs/${run.id}`].join("\n"); }
export function renderFindings(summary: RunSummary): string { if (summary.findings.length === 0) return "ANVIL · NO FINDINGS\n\nThe Forge has no recorded findings for this run."; return ["ANVIL · FINDINGS", "", ...summary.findings.map((finding) => `${finding.id}  ${finding.status.toUpperCase()}  ${finding.severity.toUpperCase()}\n${finding.title}\n${finding.description}`)].join("\n\n"); }
