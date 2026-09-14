import { Ajv } from "ajv";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "./test-helpers.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { configHash } from "../src/config/hash.ts";
import { ArtifactStore } from "../src/state/artifact-store.ts";
import { StateDatabase } from "../src/state/database.ts";
import { GitRevisionProvider, StaticRevisionProvider } from "../src/git/revision.ts";
import { MockAgentRunner } from "../src/runners/mock-agent-runner.ts";
import { createOmpCompat } from "../src/runners/omp-compat.ts";
import { OmpSubprocessRunner } from "../src/runners/omp-subprocess-runner.ts";
import { WorkflowEngine } from "../src/workflow/engine.ts";
import type { ArtifactPointer, CheckRunner, CheckResult, HandoffEnvelope, RevisionProvider, RevisionSnapshot, WorkflowConfig, WorkspaceRevision } from "../src/workflow/types.ts";
import { serializeHandoff } from "../src/context/serializers.ts";
import { sha256 } from "../src/util/hash.ts";
import { GateRepository } from "../src/state/repositories.ts";
import { AnvilError } from "../src/util/errors.ts";

const revision = (id: string): WorkspaceRevision => ({ id, head: "head", stagedSha256: id, unstagedSha256: id, untracked: [] });
const plan = { version: 1 as const, summary: "Add the requested change", assumptions: [], steps: [{ id: "step-1", title: "Implement", objective: "Implement the change", dependsOn: [], fileHints: ["src"], symbolHints: [], acceptanceCriteria: ["The change works"], risk: "low" as const, securitySurfaces: [] }], globalAcceptanceCriteria: ["The change works"], requiredChecks: [], risks: [], replanTriggers: [] };
const implementation = { version: 1 as const, status: "completed" as const, summary: "Implemented", claimedChangedFiles: ["src/change.ts"], addressedFindingIds: [], remainingConcerns: [] };
const securityPass = { version: 1 as const, verdict: "pass" as const, scope: { revisionId: "current", reviewedAreas: ["src"] }, findings: [], residualRisks: [] };
const reviewPass = { version: 1 as const, verdict: "pass" as const, acceptance: [{ criterion: "The change works", status: "satisfied" as const, evidence: "Verified" }], findings: [], notes: [] };
const checks: CheckRunner = { async run(check): Promise<CheckResult> { return { id: check.id, status: "passed", durationMs: 1, summary: `${check.id} passed` }; } };
const testChecks = [{ id: "test", command: ["test-runner"], required: true, timeoutMs: 1000 }];

async function makeEngine(root: string, provider: RevisionProvider, responses: ConstructorParameters<typeof MockAgentRunner>[0], configure?: (config: WorkflowConfig) => void, checkRunner: CheckRunner = checks) {
  const state = await StateDatabase.open(path.join(root, ".omp")); const config = structuredClone(DEFAULT_CONFIG); config.persistence.root = path.join(root, ".omp"); config.checks = structuredClone(testChecks); configure?.(config); const artifacts = new ArtifactStore(state, (runId) => path.join(root, ".omp", "runs", runId)); return new WorkflowEngine({ config, state, artifacts, revisions: provider, agents: new MockAgentRunner(responses), checks: checkRunner });
}

async function initializeReviewWorkspace(root: string) {
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
  await writeFile(path.join(root, ".gitignore"), ".omp/\n");
  await writeFile(path.join(root, "tracked.txt"), "committed\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
}

describe("WorkflowEngine", () => {
  test("retains review obligations with bounded evidence or rejects an oversized mandatory handoff", () => {
    const artifact = { id: "evidence", path: "/workspace/.omp/runs/run/changes.patch", sha256: "digest" };
    const handoff: HandoffEnvelope = {
      version: 1, runId: "run", role: "review", mutationEpoch: 1, revisionId: "target",
      objective: artifact, evidence: [{ kind: "review-diff", artifact }],
      acceptance: ["Reject unauthorized requests"],
      openFindings: [{ id: "SEC-1", source: "security", severity: "high", title: "Missing authorization", artifact }],
      constraints: { maxInlineChars: 1200, readOnly: true, noTranscript: true },
      changedFiles: Array.from({ length: 100 }, (_, i) => `long/path/${"module/".repeat(10)}${i}.ts`),
    };
    const rendered = serializeHandoff(handoff, 1200);
    expect(rendered.length).toBeLessThanOrEqual(1200);
    const bounded = JSON.parse(rendered) as HandoffEnvelope;
    expect(bounded.evidence).toEqual(handoff.evidence);
    expect(bounded.acceptance).toEqual(handoff.acceptance);
    expect(bounded.openFindings).toEqual(handoff.openFindings);
    expect(() => serializeHandoff({ ...handoff, openFindings: [{ ...handoff.openFindings![0]!, title: "Required finding detail ".repeat(100) }] }, 1200)).toThrow();
  });

  test("supplies both read-only gates with durable dirty-baseline diffs and bounded evidence pointers", async () => {
    const root = await mkdtemp("/tmp/anvil-gate-evidence-");
    try {
      await initializeReviewWorkspace(root);
      await writeFile(path.join(root, "tracked.txt"), "baseline staged\n");
      execFileSync("git", ["-C", root, "add", "tracked.txt"]);
      await writeFile(path.join(root, "tracked.txt"), "baseline unstaged\n");
      await writeFile(path.join(root, "loose.txt"), "baseline loose\n");
      const provider = new GitRevisionProvider(root); const base = await provider.current();
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan },
        { role: "implementation", structured: implementation, mutate: async () => {
          await writeFile(path.join(root, "tracked.txt"), "implemented tracked\n");
          await writeFile(path.join(root, "loose.txt"), "implemented loose\n");
          await writeFile(path.join(root, "new.txt"), "new implementation\n");
        } },
        { role: "security", structured: securityPass },
        { role: "review", structured: reviewPass },
      ]);
      const summary = await engine.start({ objective: "Review exact dirty baseline changes", workspaceRoot: root });
      expect(summary.run.currentState).toBe("DONE");
      const state = await StateDatabase.open(path.join(root, ".omp"));
      try {
        const artifacts = new ArtifactStore(state, (id) => path.join(root, ".omp", "runs", id));
        const rows = state.db.query<{ id: string; relative_path: string; sha256: string }>("SELECT id, relative_path, sha256 FROM artifacts WHERE run_id = ? AND kind = 'handoff'").all(summary.run.id);
        const reviewedRoles: string[] = [];
        for (const row of rows) {
          const handoff = await artifacts.readJson<HandoffEnvelope>(summary.run.id, { id: row.id, path: row.relative_path, sha256: row.sha256 });
          if (handoff.role !== "security" && handoff.role !== "review") continue;
          reviewedRoles.push(handoff.role);
          expect(handoff.constraints.readOnly).toBe(true);
          const text = serializeHandoff({ ...handoff, memory: [{ content: "noise".repeat(2000) }], changedFiles: Array.from({ length: 100 }, (_, i) => `long/path/${i}.ts`) }, 4000);
          expect(text.length).toBeLessThanOrEqual(4000);
          const bounded = JSON.parse(text) as HandoffEnvelope;
          expect(bounded.evidence).toEqual(handoff.evidence);
          const patch = bounded.evidence!.find((item) => item.kind === "review-diff")!.artifact;
          const manifestPointer = bounded.evidence!.find((item) => item.kind === "review-diff-manifest")!.artifact;
          const manifestBytes = await readFile(manifestPointer.path);
          expect(sha256(manifestBytes)).toBe(manifestPointer.sha256);
          const manifest = JSON.parse(manifestBytes.toString()) as { baseline: { revisionId: string; head: string; artifact: ArtifactPointer }; target: { revisionId: string; head: string; artifact: ArtifactPointer }; patch: ArtifactPointer; changedFiles: string[] };
          expect(manifest.baseline.revisionId).toBe(base.id);
          expect(manifest.baseline.head).toBe(base.head);
          expect(manifest.target.revisionId).toBe(handoff.revisionId);
          expect(manifest.target.head).toBe((await provider.current()).head);
          expect(manifest.changedFiles).toEqual(["loose.txt", "new.txt", "tracked.txt"]);
          expect(manifest.patch).toEqual(patch);
          for (const snapshot of [manifest.baseline, manifest.target]) {
            const bytes = await readFile(snapshot.artifact.path);
            expect(sha256(bytes)).toBe(snapshot.artifact.sha256);
            expect((JSON.parse(bytes.toString()) as RevisionSnapshot).revisionId).toBe(snapshot.revisionId);
          }
          const patchBytes = await readFile(patch.path);
          expect(sha256(patchBytes)).toBe(patch.sha256);
          const readable = patchBytes.toString();
          expect(readable).toContain("-baseline unstaged");
          expect(readable).toContain("+implemented tracked");
          expect(readable).toContain("-baseline loose");
          expect(readable).toContain("+implemented loose");
          expect(readable).toContain("+new implementation");
          expect(() => serializeHandoff(handoff, 100)).toThrow();
          expect(() => serializeHandoff({ ...handoff, acceptance: ["required behavior ".repeat(300)], openFindings: [{ id: "REV-1", source: "review", severity: "major", title: "Unresolved acceptance failure", artifact: patch }] }, 2000)).toThrow();
        }
        expect(reviewedRoles.sort()).toEqual(["review", "security"]);
      } finally { state.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("recovers a missing clean historical baseline after restart without repeating implementation", async () => {
    const root = await mkdtemp("/tmp/anvil-baseline-resume-");
    try {
      await initializeReviewWorkspace(root);
      const provider = new GitRevisionProvider(root); const base = await provider.current();
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan },
        { role: "implementation", structured: implementation, mutate: async () => { await writeFile(path.join(root, "tracked.txt"), "resumed implementation\n"); } },
      ], (config) => { config.budgets.maxTotalTokens = 2; });
      const paused = await engine.start({ objective: "Recover historical review context", workspaceRoot: root });
      expect(paused.run.currentState).toBe("BLOCKED");
      await rm(path.join(root, ".omp", "runs", paused.run.id, "artifacts/revisions/baseline.json"));
      const state = await StateDatabase.open(path.join(root, ".omp"));
      // Simulate a pre-snapshot run, not an in-memory provider cache.
      state.db.run("DELETE FROM artifacts WHERE run_id = ? AND kind = 'revision-baseline'", [paused.run.id]); state.close();
      const resumed = await (await makeEngine(root, new GitRevisionProvider(root), [
        { role: "security", structured: securityPass }, { role: "review", structured: reviewPass },
      ])).resume(paused.run.id);
      expect(resumed.run.currentState).toBe("DONE");
      expect(resumed.attempts.slice(0, paused.attempts.length)).toEqual(paused.attempts);
      expect(resumed.attempts.slice(paused.attempts.length).map((attempt) => attempt.state)).toEqual(["CHECKS", "SECURITY", "REVIEW"]);
      const recovered = JSON.parse(await readFile(path.join(root, ".omp", "runs", paused.run.id, "artifacts/revisions/baseline.json"), "utf8")) as RevisionSnapshot;
      expect(recovered.revisionId).toBe(base.id);
      expect(recovered.head).toBe(base.head);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("blocks an unrecoverable dirty baseline before charging or invoking a reviewer", async () => {
    const root = await mkdtemp("/tmp/anvil-dirty-baseline-");
    try {
      await initializeReviewWorkspace(root);
      await writeFile(path.join(root, "tracked.txt"), "dirty original baseline\n");
      const engine = await makeEngine(root, new GitRevisionProvider(root), [
        { role: "planner", structured: plan },
        { role: "implementation", structured: implementation, mutate: async () => { await writeFile(path.join(root, "tracked.txt"), "implementation replaced baseline\n"); } },
      ], (config) => { config.budgets.maxTotalTokens = 2; });
      const paused = await engine.start({ objective: "Never infer lost dirty contents", workspaceRoot: root });
      await rm(path.join(root, ".omp", "runs", paused.run.id, "artifacts/revisions/baseline.json"));
      let reviewerCalls = 0;
      const resumed = await (await makeEngine(root, new GitRevisionProvider(root), [
        { role: "security", structured: securityPass, mutate: () => { reviewerCalls++; } },
        { role: "review", structured: reviewPass, mutate: () => { reviewerCalls++; } },
      ])).resume(paused.run.id);
      expect(resumed.run.currentState).toBe("BLOCKED");
      expect(resumed.run.failureCode).toBe("AGENT_EXECUTION_FAILED");
      expect(resumed.run.blockedReason).toContain("baseline");
      expect(resumed.events.findLast((event) => event.type === "RUN_BLOCKED")?.state_before).toBe("SECURITY");
      expect(resumed.run.usedRequests).toBe(paused.run.usedRequests);
      expect(resumed.attempts.filter((attempt) => attempt.state === "SECURITY" || attempt.state === "REVIEW")).toEqual([]);
      expect(reviewerCalls).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects corrupt baseline artifacts instead of silently recovering a replacement", async () => {
    const root = await mkdtemp("/tmp/anvil-corrupt-baseline-");
    try {
      await initializeReviewWorkspace(root);
      const engine = await makeEngine(root, new GitRevisionProvider(root), [
        { role: "planner", structured: plan }, { role: "implementation", structured: implementation },
      ], (config) => { config.budgets.maxTotalTokens = 2; });
      const paused = await engine.start({ objective: "Require integrity-checked evidence", workspaceRoot: root });
      await writeFile(path.join(root, ".omp", "runs", paused.run.id, "artifacts/revisions/baseline.json"), "{}");
      const resumed = await (await makeEngine(root, new GitRevisionProvider(root), [])).resume(paused.run.id);
      expect(resumed.run.currentState).toBe("BLOCKED");
      expect(resumed.run.failureCode).toBe("AGENT_EXECUTION_FAILED");
      expect(resumed.run.usedRequests).toBe(paused.run.usedRequests);
      expect(resumed.attempts.filter((attempt) => attempt.state === "SECURITY" || attempt.state === "REVIEW")).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("invalidates gates when the target changes during evidence preparation without charging a stale review", async () => {
    const root = await mkdtemp("/tmp/anvil-evidence-race-");
    try {
      class RacingProvider extends StaticRevisionProvider {
        private raced = false;
        override async reviewDiff(base: RevisionSnapshot, target: RevisionSnapshot) {
          const diff = await super.reviewDiff(base, target);
          if (!this.raced) { this.raced = true; this.set(revision("rev2")); }
          return diff;
        }
      }
      const provider = new RacingProvider(revision("rev0"));
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan },
        { role: "implementation", structured: implementation, mutate: () => provider.set(revision("rev1")) },
        { role: "security", structured: securityPass }, { role: "review", structured: reviewPass },
      ]);
      const summary = await engine.start({ objective: "Reject raced review evidence", workspaceRoot: root });
      expect(summary.run.currentState).toBe("DONE");
      expect(summary.attempts.filter((attempt) => attempt.state === "CHECKS").map((attempt) => attempt.resultRevisionId)).toEqual(["rev1", "rev2"]);
      expect(summary.attempts.filter((attempt) => attempt.state === "SECURITY" || attempt.state === "REVIEW").map((attempt) => attempt.baseRevisionId)).toEqual(["rev2", "rev2"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

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
        config.persistence.root = path.join(root, ".omp");
        config.checks = structuredClone(testChecks);
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
        for (const attempt of summary.attempts.filter((item) => item.role)) {
          const output = JSON.parse(await readFile(path.join(root, ".omp", "runs", summary.run.id, `artifacts/${attempt.role}/output-${attempt.sequence}.json`), "utf8"));
          expect(output.structured).toEqual(responses[attempt.agentName!]);
          expect(output.resolvedModel).toBe(null);
          expect(output.resolvedThinkingLevel).toBe(null);
          expect(output.durationMs).toBeGreaterThan(0);
          expect(output.durationMs).toBe(attempt.durationMs);
        }
      } finally {
        state.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("persists measured execution metadata when a runner throws before returning a result", async () => {
    const root = await mkdtemp("/tmp/anvil-agent-failure-");
    const state = await StateDatabase.open(path.join(root, ".omp"));
    try {
      const config = structuredClone(DEFAULT_CONFIG); config.persistence.root = path.join(root, ".omp"); config.checks = structuredClone(testChecks);
      let observedDurationMs = 0;
      const engine = new WorkflowEngine({
        config, state, artifacts: new ArtifactStore(state, (id) => path.join(root, ".omp", "runs", id)),
        revisions: new StaticRevisionProvider(revision("rev0")), checks,
        agents: { async run() {
          const started = performance.now();
          await readFile(new URL("../agents/architect.md", import.meta.url));
          observedDurationMs = performance.now() - started;
          throw new AnvilError("MODEL_UNAVAILABLE", "Host could not resolve an authenticated model");
        } },
      });
      const started = performance.now();
      const summary = await engine.start({ objective: "Persist failed invocation metadata", workspaceRoot: root });
      const elapsed = performance.now() - started;
      expect(summary.run.failureCode).toBe("MODEL_UNAVAILABLE");
      const attempt = summary.attempts[0]!;
      const output = JSON.parse(await readFile(path.join(root, ".omp", "runs", summary.run.id, `artifacts/planner/output-${attempt.sequence}.json`), "utf8"));
      expect(output.status).toBe("failed");
      expect(output.error.code).toBe("MODEL_UNAVAILABLE");
      expect(output.resolvedModel).toBe(null);
      expect(output.resolvedThinkingLevel).toBe(null);
      expect(output.durationMs).toBeGreaterThan(observedDurationMs);
      expect(output.durationMs).toBeLessThanOrEqual(elapsed);
      expect(attempt.status).toBe("failed");
      expect(attempt.durationMs).toBe(output.durationMs);
    } finally {
      state.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  test("rejects unconfigured Warden before any model or check call, including legacy resume", async () => {
    const root = await mkdtemp("/tmp/anvil-empty-checks-");
    try {
      let calls = 0;
      const engine = await makeEngine(root, new StaticRevisionProvider(revision("rev0")), [{ role: "planner", structured: plan, mutate: () => { calls++; } }], (config) => { config.checks = []; }, { run(check) { calls++; return checks.run(check, { cwd: root }); } });
      const error = await engine.start({ objective: "No empty gate", workspaceRoot: root }).catch((error: unknown) => error);
      expect(error instanceof AnvilError && error.code).toBe("CONFIG_INVALID");
      expect(calls).toBe(0);
      const paused = await (await makeEngine(root, new StaticRevisionProvider(revision("rev0")), [], (config) => { config.budgets.maxTotalRequests = 0; })).start({ objective: "Legacy empty config", workspaceRoot: root });
      const state = await StateDatabase.open(path.join(root, ".omp"));
      const config = structuredClone(DEFAULT_CONFIG); config.persistence.root = path.join(root, ".omp"); config.budgets.maxTotalRequests = 0;
      const artifacts = new ArtifactStore(state, (id) => path.join(root, ".omp", "runs", id));
      state.db.run("UPDATE runs SET config_hash = ? WHERE id = ?", [configHash(config), paused.run.id]);
      await artifacts.putJson(paused.run.id, "config", "effective-config.json", config); state.close();
      const resumed = await engine.resume(paused.run.id).catch((error: unknown) => error);
      expect(resumed instanceof AnvilError && resumed.code).toBe("CONFIG_INVALID");
      expect(calls).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects unknown plan check IDs and optional-only plans before Smith", async () => {
    const root = await mkdtemp("/tmp/anvil-plan-checks-");
    try {
      let smithCalls = 0;
      for (const requiredChecks of [[{ id: "unconfigured", reason: "Required" }], []]) {
        const engine = await makeEngine(root, new StaticRevisionProvider(revision("rev0")), [
          { role: "planner", structured: { ...plan, requiredChecks } },
          { role: "implementation", structured: implementation, mutate: () => { smithCalls++; } },
        ], (config) => { config.checks[0]!.required = false; });
        const summary = await engine.start({ objective: "Require effective checks", workspaceRoot: root });
        expect(summary.run.failureCode).toBe("CONFIG_INVALID");
        expect(summary.attempts.map((attempt) => attempt.role)).toEqual(["planner"]);
      }
      expect(smithCalls).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("makes plan-required optional failures block Warden and participate in fail-fast", async () => {
    const root = await mkdtemp("/tmp/anvil-required-optional-");
    try {
      const executed: string[] = [];
      const engine = await makeEngine(root, new StaticRevisionProvider(revision("rev0")), [
        { role: "planner", structured: { ...plan, requiredChecks: [{ id: "test", reason: "Acceptance" }] } },
        { role: "implementation", structured: implementation },
      ], (config) => {
        config.checks = [{ ...testChecks[0]!, required: false }, { ...testChecks[0]!, id: "later", required: false }];
        config.budgets.perRole.implementation = { maxAttempts: 1 };
      }, { run(check) { executed.push(check.id); return Promise.resolve({ id: check.id, status: "failed", durationMs: 1, summary: "Acceptance failed" }); } });
      const summary = await engine.start({ objective: "Plan check failure", workspaceRoot: root });
      expect(summary.run.currentState).toBe("BLOCKED");
      expect(summary.events.some((event) => event.type === "CHECK_FAILED")).toBe(true);
      expect(executed).toEqual(["test"]);
      expect(summary.attempts.some((attempt) => attempt.state === "SECURITY")).toBe(false);
      expect(summary.findings.filter((finding) => finding.status === "open").map((finding) => finding.sourceGate)).toEqual(["checks"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("forwards readable revision-bound Smith claims and immutable captured evidence after restart", async () => {
    const root = await mkdtemp("/tmp/anvil-smith-evidence-");
    try {
      const provider = new StaticRevisionProvider(revision("rev0"));
      const output = { ...implementation, verification: [{ criterion: "Browser acceptance", status: "passed", evidence: "Observed expected page", artifactPaths: ["browser.txt"] }] };
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan },
        { role: "implementation", structured: output, mutate: async () => {
          await writeFile(path.join(root, ".omp", "runs", engine.status().run.id, "browser.txt"), "actual browser evidence");
          provider.set(revision("rev1"));
        } },
      ], (config) => { config.budgets.maxTotalTokens = 2; });
      const paused = await engine.start({ objective: "Persist Smith evidence", workspaceRoot: root });
      const runRoot = path.join(root, ".omp", "runs", paused.run.id);
      await writeFile(path.join(runRoot, "browser.txt"), "later overwritten working file");
      const resumed = await (await makeEngine(root, provider, [{ role: "security", structured: securityPass }, { role: "review", structured: reviewPass }])).resume(paused.run.id);
      expect(resumed.run.currentState).toBe("DONE");
      const state = await StateDatabase.open(path.join(root, ".omp"));
      try {
        const rows = state.db.query<{ relative_path: string }>("SELECT relative_path FROM artifacts WHERE run_id = ? AND kind = 'handoff'").all(paused.run.id);
        for (const row of rows) {
          const handoff = JSON.parse(await readFile(path.join(runRoot, row.relative_path), "utf8")) as HandoffEnvelope;
          for (const pointer of [handoff.objective, handoff.plan].filter((item): item is ArtifactPointer => !!item)) expect(sha256(await readFile(pointer.path))).toBe(pointer.sha256);
          if (handoff.role !== "security" && handoff.role !== "review") continue;
          const pointer = handoff.evidence!.find((entry) => entry.kind === "smith-implementation-claims")!.artifact;
          const bytes = await readFile(pointer.path); expect(sha256(bytes)).toBe(pointer.sha256);
          const value = JSON.parse(bytes.toString());
          expect(value.revisionId).toBe("rev1"); expect(value.mutationEpoch).toBe(1);
          expect(value.attemptId).toBe(paused.attempts.find((attempt) => attempt.role === "implementation")!.id);
          expect(value.output.verification).toEqual(output.verification);
          const supporting = value.supportingArtifacts[0].artifact as ArtifactPointer;
          expect(path.extname(supporting.path)).toBe(".txt");
          const content = await readFile(supporting.path); expect(sha256(content)).toBe(supporting.sha256);
          expect(content.toString()).toBe("actual browser evidence");
          const checkPointer = handoff.evidence!.find((entry) => entry.kind === "current-check-results")!.artifact;
          expect(sha256(await readFile(checkPointer.path))).toBe(checkPointer.sha256);
        }
      } finally { state.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects missing, absolute, escaping and symlink Smith verification files without reviewer claims", async () => {
    const root = await mkdtemp("/tmp/anvil-unsafe-evidence-");
    try {
      await writeFile(path.join(root, "outside.txt"), "outside run");
      for (const artifactPath of ["missing.txt", "../outside.txt", path.join(root, "outside.txt"), "linked/outside.txt"]) {
        const engine = await makeEngine(root, new StaticRevisionProvider(revision("rev0")), [
          { role: "planner", structured: plan },
          { role: "implementation", structured: { ...implementation, verification: [{ criterion: "Observed behavior", status: "passed", evidence: "Claim", artifactPaths: [artifactPath] }] }, mutate: async () => {
            if (artifactPath.startsWith("linked")) await symlink(root, path.join(root, ".omp", "runs", engine.status().run.id, "linked"));
          } },
        ]);
        const summary = await engine.start({ objective: "Reject unsafe evidence", workspaceRoot: root });
        expect(summary.run.failureCode).toBe("ARTIFACT_CORRUPT");
        expect(summary.attempts.some((attempt) => attempt.state === "SECURITY")).toBe(false);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  for (const scenario of ["verification-only", "source-mutation", "dependent-security", "live-validation", "unknown-live-validation", "failed-verification", "new-concern"] as const) {
    test(`invalidates only the necessary gates after ${scenario} Smith work`, async () => {
      const root = await mkdtemp("/tmp/anvil-reuse-");
      try {
        const provider = new StaticRevisionProvider(revision("rev0"));
        const independent = { ...securityPass, verificationIndependent: scenario !== "dependent-security", ...(scenario === "unknown-live-validation" ? {} : { liveValidation: scenario === "live-validation" }) };
        const needsEvidence = { ...reviewPass, verdict: "findings", findings: [{ severity: "major", category: "verification", title: "Missing browser evidence", description: "Supply observation", evidence: "Not provided", fixRequirement: "Verify the page" }] };
        const secondOutput = { ...implementation, verification: [{ criterion: "Browser acceptance", status: scenario === "failed-verification" ? "failed" : "passed", evidence: "Observed page" }], remainingConcerns: scenario === "new-concern" ? ["New authentication concern"] : [] };
        const responses: ConstructorParameters<typeof MockAgentRunner>[0] = [
          { role: "planner", structured: plan },
          { role: "implementation", structured: implementation, mutate: () => provider.set(revision("rev1")) },
          { role: "security", structured: independent },
          { role: "review", structured: needsEvidence },
          { role: "implementation", structured: secondOutput, mutate: () => { if (scenario === "source-mutation") provider.set(revision("rev2")); } },
        ];
        if (scenario !== "verification-only") responses.push({ role: "security", structured: { ...securityPass, liveValidation: false } });
        responses.push({ role: "review", structured: reviewPass });
        const engine = await makeEngine(root, provider, responses, (config) => { if (scenario === "verification-only") config.budgets.perRole.security = { maxAttempts: 1 }; });
        const summary = await engine.start({ objective: "Resolve missing evidence", workspaceRoot: root });
        expect(summary.run.currentState).toBe("DONE");
        expect(summary.attempts.filter((attempt) => attempt.state === "CHECKS")).toHaveLength(scenario === "source-mutation" ? 2 : 1);
        expect(summary.attempts.filter((attempt) => attempt.state === "SECURITY")).toHaveLength(scenario === "verification-only" ? 1 : 2);
        expect(summary.events.some((event) => event.type === "SECURITY_REUSED")).toBe(scenario === "verification-only");
        expect(summary.run.usedRequests).toBe(scenario === "verification-only" ? 6 : 7);
        expect(summary.findings.filter((finding) => finding.status === "open")).toEqual([]);
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }

  test("does not revive a pass superseded by a failed or blocked gate on another revision", async () => {
    const root = await mkdtemp("/tmp/anvil-gate-supersession-");
    try {
      const engine = await makeEngine(root, new StaticRevisionProvider(revision("rev0")), [], (config) => { config.budgets.maxTotalRequests = 0; });
      const paused = await engine.start({ objective: "Superseded pass", workspaceRoot: root });
      const state = await StateDatabase.open(path.join(root, ".omp"));
      try {
        const gates = new GateRepository(state);
        for (const verdict of ["fail", "blocked"] as const) {
          const saved = { runId: paused.run.id, gate: "security" as const, revisionId: "rev0", mutationEpoch: 0, configHash: paused.run.configHash, gatePolicyHash: "policy", verdict: "pass" as const, startedAt: "now", endedAt: "now" };
          gates.save(saved); gates.save({ ...saved, revisionId: "later", verdict });
          expect(gates.currentPass(paused.run.id, "security", "rev0", paused.run.configHash, "policy")).toBe(undefined);
        }
      } finally { state.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test("reruns Warden and Sentinel when a saved check result is corrupted", async () => {
    const root = await mkdtemp("/tmp/anvil-check-integrity-");
    try {
      const provider = new StaticRevisionProvider(revision("rev0"));
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan }, { role: "implementation", structured: implementation },
        { role: "security", structured: { ...securityPass, liveValidation: false, verificationIndependent: true } },
      ], (config) => { config.budgets.maxTotalTokens = 3; });
      const paused = await engine.start({ objective: "Do not reuse damaged checks", workspaceRoot: root });
      const state = await StateDatabase.open(path.join(root, ".omp"));
      const row = state.db.query<{ relative_path: string }>("SELECT relative_path FROM artifacts WHERE run_id = ? AND kind = 'checks'").get(paused.run.id)!;
      state.close();
      await writeFile(path.join(root, ".omp", "runs", paused.run.id, row.relative_path), "{}");
      const resumed = await (await makeEngine(root, provider, [{ role: "security", structured: securityPass }, { role: "review", structured: reviewPass }])).resume(paused.run.id);
      expect(resumed.run.currentState).toBe("DONE");
      expect(resumed.attempts.filter((attempt) => attempt.state === "CHECKS")).toHaveLength(2);
      expect(resumed.attempts.filter((attempt) => attempt.state === "SECURITY")).toHaveLength(2);
      expect(resumed.events.some((event) => event.type === "GATE_REUSE_REJECTED")).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects missing or changed captured verification dependencies after restart without charging a reviewer", async () => {
    const root = await mkdtemp("/tmp/anvil-captured-integrity-");
    try {
      for (const damage of ["missing", "changed"]) {
        const provider = new StaticRevisionProvider(revision("rev0"));
        const output = { ...implementation, verification: [{ criterion: "Acceptance", status: "passed", evidence: "Captured", artifactPaths: ["observed.txt"] }] };
        const engine = await makeEngine(root, provider, [
          { role: "planner", structured: plan },
          { role: "implementation", structured: output, mutate: async () => { await writeFile(path.join(root, ".omp", "runs", engine.status().run.id, "observed.txt"), "original"); } },
          { role: "security", structured: { ...securityPass, liveValidation: false, verificationIndependent: true } },
        ], (config) => { config.budgets.maxTotalTokens = 3; });
        const paused = await engine.start({ objective: "Keep original verification evidence", workspaceRoot: root });
        const state = await StateDatabase.open(path.join(root, ".omp"));
        const artifact = state.db.query<{ relative_path: string }>("SELECT relative_path FROM artifacts WHERE run_id = ? AND kind = 'implementation-verification-file'").get(paused.run.id)!; state.close();
        const target = path.join(root, ".omp", "runs", paused.run.id, artifact.relative_path);
        if (damage === "missing") await rm(target); else await writeFile(target, "tampered");
        const resumed = await (await makeEngine(root, provider, [])).resume(paused.run.id);
        expect(resumed.run.currentState).toBe("BLOCKED");
        expect(resumed.attempts).toEqual(paused.attempts);
        expect(resumed.run.usedRequests).toBe(paused.run.usedRequests);
        expect(resumed.events.some((event) => event.type === "GATE_REUSE_REJECTED")).toBe(true);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("reruns the Sentinel that raised a finding while preserving unaffected Warden evidence", async () => {
    const root = await mkdtemp("/tmp/anvil-security-finding-reuse-");
    try {
      const provider = new StaticRevisionProvider(revision("rev0"));
      const finding = { severity: "high", category: "authorization", title: "Unverified tenant boundary", description: "Provide scope evidence", evidence: "Missing", exploitOrImpact: "Cross-tenant access", fixRequirement: "Verify boundary", confidence: "high" };
      const engine = await makeEngine(root, provider, [
        { role: "planner", structured: plan }, { role: "implementation", structured: implementation },
        { role: "security", structured: { ...securityPass, verdict: "findings", findings: [finding], liveValidation: false } },
        { role: "implementation", structured: implementation },
        { role: "security", structured: securityPass }, { role: "review", structured: reviewPass },
      ]);
      const summary = await engine.start({ objective: "Resolve security finding", workspaceRoot: root });
      expect(summary.run.currentState).toBe("DONE");
      expect(summary.attempts.filter((attempt) => attempt.state === "CHECKS")).toHaveLength(1);
      expect(summary.attempts.filter((attempt) => attempt.state === "SECURITY")).toHaveLength(2);
      expect(summary.events.some((event) => event.type === "SECURITY_REUSED")).toBe(false);
      const state = await StateDatabase.open(path.join(root, ".omp"));
      try {
        const row = state.db.query<{ relative_path: string }>("SELECT relative_path FROM artifacts WHERE run_id = ? AND kind = 'handoff' AND attempt_id = ?").get(summary.run.id, summary.attempts.filter((attempt) => attempt.role === "implementation")[1]!.id)!;
        const handoff = JSON.parse(await readFile(path.join(root, ".omp", "runs", summary.run.id, row.relative_path), "utf8")) as HandoffEnvelope;
        const pointer = handoff.openFindings![0]!.artifact;
        expect(sha256(await readFile(pointer.path))).toBe(pointer.sha256);
        expect(JSON.parse(await readFile(pointer.path, "utf8")).findings[0].fixRequirement).toBe("Verify boundary");
      } finally { state.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
