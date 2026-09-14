import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "./test-helpers.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { ArtifactStore } from "../src/state/artifact-store.ts";
import { StateDatabase } from "../src/state/database.ts";
import { StaticRevisionProvider } from "../src/git/revision.ts";
import { MockAgentRunner } from "../src/runners/mock-agent-runner.ts";
import { WorkflowEngine } from "../src/workflow/engine.ts";
import type { CheckRunner, CheckResult, WorkspaceRevision } from "../src/workflow/types.ts";

const revision = (id: string): WorkspaceRevision => ({ id, head: "head", stagedSha256: id, unstagedSha256: id, untracked: [] });
const plan = { version: 1 as const, summary: "Add the requested change", assumptions: [], steps: [{ id: "step-1", title: "Implement", objective: "Implement the change", dependsOn: [], fileHints: ["src"], symbolHints: [], acceptanceCriteria: ["The change works"], risk: "low" as const, securitySurfaces: [] }], globalAcceptanceCriteria: ["The change works"], requiredChecks: [], risks: [], replanTriggers: [] };
const implementation = { version: 1 as const, status: "completed" as const, summary: "Implemented", claimedChangedFiles: ["src/change.ts"], addressedFindingIds: [], remainingConcerns: [] };
const securityPass = { version: 1 as const, verdict: "pass" as const, scope: { revisionId: "current", reviewedAreas: ["src"] }, findings: [], residualRisks: [] };
const reviewPass = { version: 1 as const, verdict: "pass" as const, acceptance: [{ criterion: "The change works", status: "satisfied" as const, evidence: "Verified" }], findings: [], notes: [] };
const checks: CheckRunner = { async run(check): Promise<CheckResult> { return { id: check.id, status: "passed", durationMs: 1, summary: `${check.id} passed` }; } };

async function makeEngine(root: string, provider: StaticRevisionProvider, responses: ConstructorParameters<typeof MockAgentRunner>[0]) {
  const state = await StateDatabase.open(path.join(root, ".omp")); const config = structuredClone(DEFAULT_CONFIG); config.persistence.root = path.join(root, ".omp"); config.checks = []; const artifacts = new ArtifactStore(state, (runId) => path.join(root, ".omp", "runs", runId)); return new WorkflowEngine({ config, state, artifacts, revisions: provider, agents: new MockAgentRunner(responses), checks });
}

describe("WorkflowEngine", () => {
  test("seals a run only after all exact-revision gates pass", async () => {
    const root = await mkdtemp("/tmp/anvil-test-"); const provider = new StaticRevisionProvider(revision("rev0")); const engine = await makeEngine(root, provider, [
      { role: "planner", structured: plan },
      { role: "implementation", structured: implementation, mutate: () => provider.set(revision("rev1")) },
      { role: "security", structured: securityPass },
      { role: "review", structured: reviewPass },
    ]);
    const progress: string[] = []; const summary = await engine.start({ objective: "Add a change", workspaceRoot: root, progress: (update) => { progress.push(`${update.kind}:${update.run.currentState}`); } }); expect(summary.run.currentState).toBe("DONE"); expect(summary.run.currentRevisionId).toBe("rev1"); expect(summary.events.filter((event) => event.type === "STATE_TRANSITION")).toHaveLength(0); expect(summary.events.some((event) => event.type === "RUN_DONE")).toBeTruthy(); expect(progress).toEqual(["started:PLAN", "stage:PLAN", "stage:IMPLEMENT", "stage:CHECKS", "stage:SECURITY", "stage:REVIEW", "finished:DONE"]); await rm(root, { recursive: true, force: true });
  });

  test("routes a security finding through implementation and re-runs every gate", async () => {
    const root = await mkdtemp("/tmp/anvil-test-"); const provider = new StaticRevisionProvider(revision("rev0")); const finding = { severity: "high" as const, category: "authorization", title: "Missing tenant authorization", description: "The endpoint does not enforce tenant scope", evidence: "Observed route", exploitOrImpact: "Cross-tenant access", fixRequirement: "Enforce tenant scope", confidence: "high" as const };
    const engine = await makeEngine(root, provider, [
      { role: "planner", structured: plan },
      { role: "implementation", structured: implementation, mutate: () => provider.set(revision("rev1")) },
      { role: "security", structured: { version: 1 as const, verdict: "findings" as const, scope: { revisionId: "rev1", reviewedAreas: ["src"] }, findings: [finding], residualRisks: [] } },
      { role: "implementation", structured: implementation, mutate: () => provider.set(revision("rev2")) },
      { role: "security", structured: securityPass },
      { role: "review", structured: reviewPass },
    ]);
    const summary = await engine.start({ objective: "Secure a change", workspaceRoot: root }); expect(summary.run.currentState).toBe("DONE"); expect(summary.run.mutationEpoch).toBe(2); expect(summary.attempts.filter((attempt) => attempt.state === "SECURITY")).toHaveLength(2); expect(summary.attempts.filter((attempt) => attempt.state === "CHECKS")).toHaveLength(2); expect(summary.findings.some((item) => item.status === "resolved")).toBeTruthy(); await rm(root, { recursive: true, force: true });
  });

  test("blocks a repeated blocking finding instead of looping forever", async () => {
    const root = await mkdtemp("/tmp/anvil-no-progress-"); const provider = new StaticRevisionProvider(revision("rev0")); const finding = { severity: "high" as const, category: "authorization", title: "Missing tenant authorization", description: "The endpoint does not enforce tenant scope", evidence: "Observed route", exploitOrImpact: "Cross-tenant access", fixRequirement: "Enforce tenant scope", confidence: "high" as const }; const engine = await makeEngine(root, provider, [
      { role: "planner", structured: plan },
      { role: "implementation", structured: implementation, mutate: () => provider.set(revision("rev1")) },
      { role: "security", structured: { version: 1 as const, verdict: "findings" as const, scope: { revisionId: "rev1", reviewedAreas: ["src"] }, findings: [finding], residualRisks: [] } },
      { role: "implementation", structured: implementation, mutate: () => provider.set(revision("rev2")) },
      { role: "security", structured: { version: 1 as const, verdict: "findings" as const, scope: { revisionId: "rev2", reviewedAreas: ["src"] }, findings: [finding], residualRisks: [] } },
      { role: "implementation", structured: implementation, mutate: () => provider.set(revision("rev3")) },
      { role: "security", structured: { version: 1 as const, verdict: "findings" as const, scope: { revisionId: "rev3", reviewedAreas: ["src"] }, findings: [finding], residualRisks: [] } },
    ]);
    const summary = await engine.start({ objective: "Stop repeated security findings", workspaceRoot: root }); expect(summary.run.currentState).toBe("BLOCKED"); expect(summary.run.failureCode).toBe("NO_PROGRESS"); await rm(root, { recursive: true, force: true });
  });
});
