import { Ajv } from "ajv";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "./test-helpers.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { ArtifactStore } from "../src/state/artifact-store.ts";
import { StateDatabase } from "../src/state/database.ts";
import { StaticRevisionProvider } from "../src/git/revision.ts";
import { MockAgentRunner } from "../src/runners/mock-agent-runner.ts";
import { createOmpCompat } from "../src/runners/omp-compat.ts";
import { OmpSubprocessRunner } from "../src/runners/omp-subprocess-runner.ts";
import { WorkflowEngine } from "../src/workflow/engine.ts";
import type { CheckRunner, CheckResult, WorkflowConfig, WorkspaceRevision } from "../src/workflow/types.ts";

const revision = (id: string): WorkspaceRevision => ({ id, head: "head", stagedSha256: id, unstagedSha256: id, untracked: [] });
const plan = { version: 1 as const, summary: "Add the requested change", assumptions: [], steps: [{ id: "step-1", title: "Implement", objective: "Implement the change", dependsOn: [], fileHints: ["src"], symbolHints: [], acceptanceCriteria: ["The change works"], risk: "low" as const, securitySurfaces: [] }], globalAcceptanceCriteria: ["The change works"], requiredChecks: [], risks: [], replanTriggers: [] };
const implementation = { version: 1 as const, status: "completed" as const, summary: "Implemented", claimedChangedFiles: ["src/change.ts"], addressedFindingIds: [], remainingConcerns: [] };
const securityPass = { version: 1 as const, verdict: "pass" as const, scope: { revisionId: "current", reviewedAreas: ["src"] }, findings: [], residualRisks: [] };
const reviewPass = { version: 1 as const, verdict: "pass" as const, acceptance: [{ criterion: "The change works", status: "satisfied" as const, evidence: "Verified" }], findings: [], notes: [] };
const checks: CheckRunner = { async run(check): Promise<CheckResult> { return { id: check.id, status: "passed", durationMs: 1, summary: `${check.id} passed` }; } };

async function makeEngine(root: string, provider: StaticRevisionProvider, responses: ConstructorParameters<typeof MockAgentRunner>[0], configure?: (config: WorkflowConfig) => void) {
  const state = await StateDatabase.open(path.join(root, ".omp")); const config = structuredClone(DEFAULT_CONFIG); config.persistence.root = path.join(root, ".omp"); config.checks = []; configure?.(config); const artifacts = new ArtifactStore(state, (runId) => path.join(root, ".omp", "runs", runId)); return new WorkflowEngine({ config, state, artifacts, revisions: provider, agents: new MockAgentRunner(responses), checks });
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

  test("honors a blocked final review instead of sealing the run", async () => {
    const root = await mkdtemp("/tmp/anvil-review-blocked-");
    try {
      const provider = new StaticRevisionProvider(revision("rev0"));
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan },
        { role: "implementation", structured: implementation },
        { role: "security", structured: securityPass },
        { role: "review", structured: { ...reviewPass, verdict: "blocked", blockedReason: "Acceptance evidence is unavailable" } },
      ]);
      const summary = await engine.start({ objective: "Respect review decision", workspaceRoot: root });
      expect(summary.run.currentState).toBe("BLOCKED");
      expect(summary.run.blockedReason).toContain("Acceptance evidence is unavailable");
      expect(summary.events.some((event) => event.type === "RUN_DONE")).toBe(false);
      const resumedEngine = await makeEngine(root, provider, [{ role: "review", structured: reviewPass }]);
      const resumed = await resumedEngine.resume(summary.run.id);
      expect(resumed.run.currentState).toBe("DONE");
      expect(resumed.attempts.filter((attempt) => attempt.state !== "REVIEW")).toEqual(summary.attempts.filter((attempt) => attempt.state !== "REVIEW"));
      expect(resumed.run.usedTokens).toBe(summary.run.usedTokens + 1);
      expect(resumed.run.blockedReason).toBe(undefined);
      expect(resumed.run.failureCode).toBe(undefined);
      expect((await resumedEngine.resume(summary.run.id)).attempts).toEqual(resumed.attempts);
      await resumedEngine.cancel(summary.run.id);
      expect(resumedEngine.status(summary.run.id).run.currentState).toBe("DONE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("resumes legacy token-blocked CHECKS without repeating completed work or resetting usage", async () => {
    const root = await mkdtemp("/tmp/anvil-budget-resume-");
    try {
      const provider = new StaticRevisionProvider(revision("rev0"));
      const capped = (config: WorkflowConfig) => { config.budgets.maxTotalTokens = 2; };
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan },
        { role: "implementation", structured: implementation, mutate: () => provider.set(revision("rev1")) },
      ], capped);
      const blocked = await engine.start({ objective: "Resume completed implementation", workspaceRoot: root });
      expect(blocked.run.currentState).toBe("BLOCKED");
      expect(blocked.events.findLast((event) => event.type === "RUN_BLOCKED")?.state_before).toBe("CHECKS");
      expect(blocked.run.finishedAt).toBe(undefined);
      const stillCapped = await makeEngine(root, provider, [], capped);
      const unchanged = await stillCapped.resume(blocked.run.id);
      expect(unchanged.run.currentState).toBe("BLOCKED");
      expect(unchanged.attempts).toEqual(blocked.attempts);
      expect(unchanged.events).toEqual(blocked.events);
      expect(unchanged.run.transitionCount).toBe(blocked.run.transitionCount);
      const requestCapped = await makeEngine(root, provider, [], (config) => { config.budgets.maxTotalRequests = 2; });
      const differentLimit = await requestCapped.resume(blocked.run.id);
      expect(differentLimit.run.currentState).toBe("BLOCKED");
      expect(differentLimit.run.blockedReason).toContain("request budget");
      expect(differentLimit.run.maxTotalTokens).toBe(undefined);
      expect(differentLimit.run.maxTotalRequests).toBe(2);
      expect(differentLimit.events).toEqual(blocked.events);
      expect(differentLimit.attempts).toEqual(blocked.attempts);
      const state = await StateDatabase.open(path.join(root, ".omp"));
      // Older versions marked pauses as finished. Retain their accumulated usage.
      state.db.run("UPDATE runs SET finished_at = ?, failure_message = ?, used_tokens = ?, used_cache_read_tokens = ? WHERE id = ?", ["2026-01-01T00:00:00.000Z", "Old budget failure", 1_486_513, 1_394_816, blocked.run.id]);
      state.close();
      const resumedEngine = await makeEngine(root, provider, [
        { role: "security", structured: securityPass },
        { role: "review", structured: reviewPass },
      ]);
      const stages: string[] = [];
      const resumed = await resumedEngine.resume(blocked.run.id, (update) => {
        if (update.kind !== "stage") return;
        stages.push(update.run.currentState);
        expect(update.run.finishedAt).toBe(undefined);
        expect(update.run.blockedReason).toBe(undefined);
        expect(update.run.failureCode).toBe(undefined);
        expect(update.run.failureMessage).toBe(undefined);
      });
      expect(stages).toEqual(["CHECKS", "SECURITY", "REVIEW"]);
      expect(resumed.run.currentState).toBe("DONE");
      expect(resumed.run.maxTotalTokens).toBe(undefined);
      expect(resumed.run.usedTokens).toBe(1_486_515);
      expect(resumed.run.usedCacheReadTokens).toBe(1_394_816);
      expect(resumed.run.usedRequests).toBe(blocked.run.usedRequests + 2);
      expect(resumed.run.planPath).toBe(blocked.run.planPath);
      expect(resumed.run.configHash).toBe(blocked.run.configHash);
      expect(resumed.run.mutationEpoch).toBe(blocked.run.mutationEpoch);
      expect(resumed.attempts.slice(0, 2)).toEqual(blocked.attempts);
      expect(resumed.attempts.map((attempt) => attempt.state)).toEqual(["PLAN", "IMPLEMENT", "CHECKS", "SECURITY", "REVIEW"]);
      expect(resumed.run.transitionCount).toBe(blocked.run.transitionCount + 3);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("raising a transition cap permits work without charging a transition for unblocking", async () => {
    const root = await mkdtemp("/tmp/anvil-transition-resume-");
    try {
      const provider = new StaticRevisionProvider(revision("rev0"));
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan },
        { role: "implementation", structured: implementation },
      ], (config) => { config.budgets.maxTransitions = 3; });
      const blocked = await engine.start({ objective: "Raise transition limit", workspaceRoot: root });
      expect(blocked.run.currentState).toBe("BLOCKED");
      provider.set(revision("rev-external"));
      const resumedEngine = await makeEngine(root, provider, [], (config) => { config.budgets.maxTransitions = 4; });
      const resumed = await resumedEngine.resume(blocked.run.id);
      expect(resumed.run.currentState).toBe("BLOCKED");
      expect(resumed.events.findLast((event) => event.type === "RUN_BLOCKED")?.state_before).toBe("SECURITY");
      expect(resumed.attempts.map((attempt) => attempt.state)).toEqual(["PLAN", "IMPLEMENT", "CHECKS"]);
      expect(resumed.run.transitionCount).toBe(4);
      expect(resumed.run.maxTransitions).toBe(4);
      expect(resumed.run.usedTokens).toBe(blocked.run.usedTokens);
      expect(resumed.run.currentRevisionId).toBe("rev-external");
      expect(resumed.run.mutationEpoch).toBe(blocked.run.mutationEpoch + 1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("keeps role-token exhaustion paused until its explicit limit is removed", async () => {
    const root = await mkdtemp("/tmp/anvil-role-resume-");
    try {
      const provider = new StaticRevisionProvider(revision("rev0"));
      const capped = (config: WorkflowConfig) => { config.budgets.perRole.implementation!.maxTokens = 1; };
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan },
        { role: "implementation", structured: { ...implementation, status: "blocked" } },
      ], capped);
      const blocked = await engine.start({ objective: "Unblock Smith", workspaceRoot: root });
      const sameLimit = await makeEngine(root, provider, [], capped);
      const unchanged = await sameLimit.resume(blocked.run.id);
      expect(unchanged.run.currentState).toBe("BLOCKED");
      expect(unchanged.attempts).toEqual(blocked.attempts);
      expect(unchanged.events).toEqual(blocked.events);
      const uncapped = await makeEngine(root, provider, [
        { role: "implementation", structured: implementation },
        { role: "security", structured: securityPass },
        { role: "review", structured: reviewPass },
      ]);
      const resumed = await uncapped.resume(blocked.run.id);
      expect(resumed.run.currentState).toBe("DONE");
      expect(resumed.attempts.map((attempt) => attempt.state)).toEqual(["PLAN", "IMPLEMENT", "IMPLEMENT", "CHECKS", "SECURITY", "REVIEW"]);
      expect(resumed.run.usedTokens).toBe(blocked.run.usedTokens + 3);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("cancels paused runs permanently and leaves failures final", async () => {
    const root = await mkdtemp("/tmp/anvil-paused-cancel-");
    try {
      const provider = new StaticRevisionProvider(revision("rev0"));
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan },
        { role: "implementation", structured: { ...implementation, status: "blocked" } },
      ]);
      const blocked = await engine.start({ objective: "Cancel a pause", workspaceRoot: root });
      await engine.cancel(blocked.run.id);
      const cancelled = await engine.resume(blocked.run.id);
      expect(cancelled.run.currentState).toBe("CANCELLED");
      expect(cancelled.run.finishedAt).toBeTruthy();
      expect(cancelled.attempts).toEqual(blocked.attempts);
      const failedEngine = await makeEngine(root, provider, [{ role: "planner", status: "failed" }]);
      const failed = await failedEngine.start({ objective: "Keep failure final", workspaceRoot: root });
      expect(failed.run.currentState).toBe("FAILED");
      expect(await failedEngine.resume(failed.run.id)).toEqual(failed);
      await failedEngine.cancel(failed.run.id);
      expect(failedEngine.status(failed.run.id).run.currentState).toBe("FAILED");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects non-budget policy changes without relabeling saved gate evidence", async () => {
    const root = await mkdtemp("/tmp/anvil-policy-resume-");
    try {
      const provider = new StaticRevisionProvider(revision("rev0"));
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan },
        { role: "implementation", structured: implementation },
        { role: "security", structured: securityPass },
        { role: "review", structured: { ...reviewPass, verdict: "blocked", blockedReason: "Waiting for evidence" } },
      ]);
      const blocked = await engine.start({ objective: "Preserve gate policy", workspaceRoot: root });
      const changedPolicy = await makeEngine(root, provider, [], (config) => { config.security.failOn = ["critical"]; });
      await expect(changedPolicy.resume(blocked.run.id)).rejects.toThrow("Only budget configuration may change");
      expect(changedPolicy.status(blocked.run.id)).toEqual(blocked);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rechecks external mutations before resuming a paused final review", async () => {
    const root = await mkdtemp("/tmp/anvil-mutated-resume-");
    try {
      const provider = new StaticRevisionProvider(revision("rev0"));
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan },
        { role: "implementation", structured: implementation },
        { role: "security", structured: securityPass },
        { role: "review", structured: { ...reviewPass, verdict: "blocked", blockedReason: "Waiting for evidence" } },
      ]);
      const blocked = await engine.start({ objective: "Reject stale passes", workspaceRoot: root });
      provider.set(revision("rev-external"));
      const resumedEngine = await makeEngine(root, provider, [
        { role: "security", structured: securityPass },
        { role: "review", structured: reviewPass },
      ]);
      const resumed = await resumedEngine.resume(blocked.run.id);
      expect(resumed.run.currentState).toBe("DONE");
      expect(resumed.run.currentRevisionId).toBe("rev-external");
      expect(resumed.run.mutationEpoch).toBe(blocked.run.mutationEpoch + 1);
      expect(resumed.attempts.slice(blocked.attempts.length).map((attempt) => [attempt.state, attempt.resultRevisionId])).toEqual([["CHECKS", "rev-external"], ["SECURITY", "rev-external"], ["REVIEW", "rev-external"]]);
      expect(resumed.attempts.slice(0, blocked.attempts.length)).toEqual(blocked.attempts);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("runs every role with enforceable output schemas through both OMP execution paths", async () => {
    const ajv = new Ajv({ strict: true });
    const responses: Record<string, unknown> = { architect: plan, smith: implementation, sentinel: securityPass, inquisitor: reviewPass };
    for (const isolated of [false, true]) {
      const root = await mkdtemp("/tmp/anvil-contract-engine-");
      const state = await StateDatabase.open(path.join(root, ".omp"));
      try {
        const config = structuredClone(DEFAULT_CONFIG);
        config.implementation.isolation.enabled = isolated;
        const validateOutput = (params: unknown) => {
          if (!params || typeof params !== "object" || !("outputSchema" in params) || !("agent" in params)) {
            throw new Error("Host requires an agent and output schema");
          }
          const agent = params.agent;
          const name = typeof agent === "string" ? agent :
            agent && typeof agent === "object" && "name" in agent && typeof agent.name === "string" ? agent.name : "";
          const schema = params.outputSchema;
          if (!schema || typeof schema !== "object") throw new Error("Host requires a JSON schema");
          const validate = ajv.compile(schema);
          const data = responses[name];
          const valid = validate(data);
          return {
            agent: name, exitCode: valid ? 0 : 1,
            structuredOutput: { status: valid ? "valid" : "invalid", data, error: valid ? undefined : ajv.errorsText(validate.errors) },
            usage: { totalTokens: 1 }, requests: 1,
          };
        };
        const agents = new OmpSubprocessRunner(createOmpCompat({}, {
          Settings: { loadReadOnly: async () => ({ get: () => [], override: () => {} }) },
          discoverAgents: async () => ({ agents: Object.keys(responses).map((name) => ({ name, tools: ["read"] })) }),
          runSubprocess: async (params: unknown) => validateOutput(params),
          TaskTool: { create: async () => ({
            execute: async (_id: string, params: unknown) => ({ details: { results: [validateOutput(params)] } }),
          }) },
        }));
        const engine = new WorkflowEngine({
          config, state, artifacts: new ArtifactStore(state, (id) => path.join(root, ".omp", "runs", id)),
          revisions: new StaticRevisionProvider(revision("rev0")), agents, checks,
        });
        const summary = await engine.start({ objective: "Exercise every output contract", workspaceRoot: root });
        expect(summary.run.currentState).toBe("DONE");
        expect(summary.attempts.map((attempt) => attempt.state)).toEqual(["PLAN", "IMPLEMENT", "CHECKS", "SECURITY", "REVIEW"]);
      } finally {
        state.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  });
});
