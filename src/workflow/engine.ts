import path from "node:path";
import { configHash } from "../config/hash.ts";
import { ContextBuilder } from "../context/builder.ts";
import { FindingLifecycle } from "../findings/lifecycle.ts";
import { BudgetManager } from "../budget/ledger.ts";
import { AnvilError, asAnvilError } from "../util/errors.ts";
import { assertCanComplete } from "./invariants.ts";
import { assertLegalTransition, nextAfterReview, nextAfterSecurity } from "./transitions.ts";
import { isTerminal, statusForState } from "./state.ts";
import type { AgentRunner, ArtifactPointer, AttemptRecord, CheckResult, CheckRunner, Clock, FindingRecord, MemoryAdapter, PlanOutput, ReviewOutput, RunRecord, SecurityOutput, WorkflowConfig, WorkflowProgressHandler, WorkflowProgressKind, WorkflowState, RevisionProvider } from "./types.ts";
import { StateDatabase } from "../state/database.ts";
import { ArtifactStore } from "../state/artifact-store.ts";
import { EventStore } from "../state/event-store.ts";
import { FindingRepository, GateRepository, RunRepository } from "../state/repositories.ts";
import { requireImplementation, requirePlan, requireReview, requireSecurity } from "../schemas/validate.ts";

export interface WorkflowEngineDependencies { config: WorkflowConfig; state: StateDatabase; artifacts: ArtifactStore; revisions: RevisionProvider; agents: AgentRunner; checks: CheckRunner; memory?: MemoryAdapter; clock?: Clock; }
export interface StartRunInput { objective: string; workspaceRoot: string; progress?: WorkflowProgressHandler; }
export interface RunSummary { run: RunRecord; events: Array<Record<string, unknown>>; findings: FindingRecord[]; attempts: AttemptRecord[]; }

const SYSTEM_CLOCK: Clock = { now: () => new Date() };

export class WorkflowEngine {
  private readonly runs: RunRepository;
  private readonly gates: GateRepository;
  private readonly findings: FindingRepository;
  private readonly events: EventStore;
  private readonly context: ContextBuilder;
  private readonly budget: BudgetManager;
  private readonly lifecycle: FindingLifecycle;
  private readonly clock: Clock;
  private readonly objectivePointers = new Map<string, ArtifactPointer>();
  private readonly lessons = new Map<string, Array<{ content: string; importance: number }>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly progress = new Map<string, WorkflowProgressHandler>();

  constructor(private readonly deps: WorkflowEngineDependencies) {
    this.runs = new RunRepository(deps.state); this.gates = new GateRepository(deps.state); this.findings = new FindingRepository(deps.state); this.events = new EventStore(deps.state); this.context = new ContextBuilder(deps.config); this.budget = new BudgetManager(deps.config); this.lifecycle = new FindingLifecycle(this.findings); this.clock = deps.clock ?? SYSTEM_CLOCK;
  }

  async start(input: StartRunInput): Promise<RunSummary> {
    const objective = input.objective.trim(); if (!objective) throw new AnvilError("CONFIG_INVALID", "Objective cannot be empty");
    const revision = await this.deps.revisions.current(); const runId = `run_${crypto.randomUUID()}`;
    const run = this.runs.create({ id: runId, workflowName: this.deps.config.workflow.name, workflowVersion: 1, configHash: configHash(this.deps.config), workspaceRoot: input.workspaceRoot, objectivePath: path.join("runs", runId, "objective.md"), baseRevisionId: revision.id, currentRevisionId: revision.id, mutationEpoch: 0, initialHead: revision.head, maxTotalTokens: this.deps.config.budgets.maxTotalTokens, maxTotalRequests: this.deps.config.budgets.maxTotalRequests, maxTransitions: this.deps.config.budgets.maxTransitions, maxWallClockMs: this.deps.config.budgets.maxWallClockMs });
    const pointer = await this.deps.artifacts.putText(run.id, "objective", "objective.md", objective, "text/markdown"); this.objectivePointers.set(run.id, pointer); await this.deps.artifacts.putJson(run.id, "config", "effective-config.json", this.deps.config);
    const started = this.transition(run, "PLAN", "RUN_STARTED", { objective: pointer.path }); if (input.progress) this.progress.set(run.id, input.progress); await this.report(started, "started"); this.controllers.set(run.id, new AbortController());
    try { return await this.drive(started, this.controllers.get(run.id)!.signal); } finally { this.controllers.delete(run.id); this.progress.delete(run.id); }
  }
  async resume(runId: string, progress?: WorkflowProgressHandler): Promise<RunSummary> {
    let run = this.runs.require(runId); if (isTerminal(run.currentState)) return this.summary(run);
    this.runs.markRunningInterrupted(runId); const current = await this.deps.revisions.current(); const changedDuringImplementation = run.currentState === "IMPLEMENT" && current.id !== run.currentRevisionId;
    if (changedDuringImplementation) { run = this.updateRevision(run, current.id, "IMPLEMENTATION_INTERRUPTED_WITH_CHANGES"); run = this.transition(run, "CHECKS", "IMPLEMENTATION_INTERRUPTED_WITH_CHANGES", { revisionId: current.id }); }
    if (progress) this.progress.set(runId, progress);
    this.controllers.set(runId, new AbortController()); try { return await this.drive(this.runs.require(runId), this.controllers.get(runId)!.signal); } finally { this.controllers.delete(runId); this.progress.delete(runId); }
  }


  async cancel(runId: string): Promise<void> { const controller = this.controllers.get(runId); controller?.abort(); const run = this.runs.require(runId); if (!isTerminal(run.currentState)) this.transition(run, "CANCELLED", "RUN_CANCELLED"); }
  status(runId?: string): RunSummary { const run = runId ? this.runs.require(runId) : this.runs.latest(); if (!run) throw new AnvilError("RUN_NOT_FOUND", "No Anvil runs exist"); return this.summary(run); }

  private async drive(initial: RunRecord, signal: AbortSignal): Promise<RunSummary> {
    let run = initial;
    while (!isTerminal(run.currentState)) {
      try { this.budget.assertMayContinue(run); } catch (error) { run = this.block(run, asAnvilError(error, "BUDGET_EXHAUSTED")); break; }
      if (signal.aborted) { run = this.transition(run, "CANCELLED", "RUN_CANCELLED"); break; }
      try {
        await this.report(run, "stage");
        switch (run.currentState) {
          case "PLAN": run = await this.executePlan(run, signal); break;
          case "IMPLEMENT": run = await this.executeImplementation(run, signal); break;
          case "CHECKS": run = await this.executeChecks(run, signal); break;
          case "SECURITY": run = await this.executeSecurity(run, signal); break;
          case "REVIEW": run = await this.executeReview(run, signal); break;
          default: throw new AnvilError("INVARIANT_VIOLATION", `Cannot drive state ${run.currentState}`);
        }
      } catch (error) { const typed = asAnvilError(error); run = typed.code === "BUDGET_EXHAUSTED" || typed.code === "MAX_ATTEMPTS_EXCEEDED" ? this.block(run, typed) : this.fail(run, typed); }
    }
    await this.report(run, "finished");
    return this.summary(run);
  }

  private async executePlan(run: RunRecord, signal: AbortSignal): Promise<RunRecord> {
    const plannerAttempts = this.runs.attemptsFor(run.id, "PLAN"); this.budget.assertRoleMayRun(run, "planner", plannerAttempts.length, plannerAttempts.reduce((total, attempt) => total + attempt.tokens, 0)); const before = await this.deps.revisions.current(); if (before.id !== run.currentRevisionId) return this.updateRevision(run, before.id, "PLAN_EXTERNAL_MUTATION");
    const attempt = this.runs.beginAttempt(run, "PLAN", "planner", this.deps.config.agents.planner.agent); const handoff = this.context.build("planner", { run, objective: this.objective(run), acceptance: [] }); await this.deps.artifacts.putJson(run.id, "handoff", `artifacts/planner/handoff-${attempt.sequence}.json`, handoff.envelope, attempt.id);
    const result = await this.deps.agents.run<PlanOutput>({ runId: run.id, attemptId: attempt.id, role: "planner", agentName: this.deps.config.agents.planner.agent, assignment: "Produce the strict PlanOutput for this objective.", context: handoff.text, outputSchema: { name: "PlanOutput", version: 1 }, schemaMode: "strict", cwd: run.workspaceRoot, baseRevisionId: run.currentRevisionId, readOnly: true, signal }); const after = await this.deps.revisions.current(); this.runs.finalizeAttempt(attempt, { ...result, resultRevisionId: after.id });
    if (after.id !== run.currentRevisionId) throw new AnvilError("READ_ONLY_GATE_MUTATED_WORKSPACE", "Architect mutated the workspace"); if (result.status !== "completed") throw new AnvilError("AGENT_EXECUTION_FAILED", result.error?.message ?? "Architect failed");
    const plan = requirePlan(result.structured); const planPointer = await this.deps.artifacts.putJson(run.id, "plan", "plan.json", plan, attempt.id); const updated = this.runs.update(run.id, { plan_path: planPointer.path }); return this.transition(updated, "IMPLEMENT", "PLAN_COMPLETED", { plan: planPointer.path });
  }

  private async executeImplementation(run: RunRecord, signal: AbortSignal): Promise<RunRecord> {
    const implementationAttempts = this.runs.attemptsFor(run.id, "IMPLEMENT"); this.budget.assertRoleMayRun(run, "implementation", implementationAttempts.length, implementationAttempts.reduce((total, attempt) => total + attempt.tokens, 0)); const before = await this.deps.revisions.current(); if (before.id !== run.currentRevisionId) return this.mutation(run, before.id, "EXTERNAL_WORKSPACE_MUTATION");
    const attempt = this.runs.beginAttempt(run, "IMPLEMENT", "implementation", this.deps.config.agents.implementation.agent); const open = this.findings.list(run.id, "open"); const handoff = this.context.build("implementation", { run, objective: this.objective(run), plan: run.planPath ? { id: "plan", path: run.planPath, sha256: "" } : undefined, findings: open, changedFiles: await this.deps.revisions.changedFiles(run.baseRevisionId, run.currentRevisionId) }); await this.deps.artifacts.putJson(run.id, "handoff", `artifacts/implementation/handoff-${attempt.sequence}.json`, handoff.envelope, attempt.id);
    const result = await this.deps.agents.run({ runId: run.id, attemptId: attempt.id, role: "implementation", agentName: this.deps.config.agents.implementation.agent, assignment: "Implement the active plan and resolve the referenced open findings.", context: handoff.text, outputSchema: { name: "ImplementationOutput", version: 1 }, schemaMode: "strict", cwd: run.workspaceRoot, baseRevisionId: before.id, readOnly: false, isolation: { requested: this.deps.config.implementation.isolation.enabled, apply: true, merge: this.deps.config.implementation.isolation.merge }, signal }); const after = await this.deps.revisions.current(); this.runs.finalizeAttempt(attempt, { ...result, resultRevisionId: after.id });
    if (result.status !== "completed") throw new AnvilError("AGENT_EXECUTION_FAILED", result.error?.message ?? "Smith failed"); let output; try { output = requireImplementation(result.structured); } catch (error) { throw asAnvilError(error, "SCHEMA_INVALID"); } if (output.durableLessons?.length) this.lessons.set(run.id, output.durableLessons);
    if (after.id !== before.id) return this.mutation(run, after.id, "IMPLEMENTATION_COMPLETED"); if (output.status === "blocked") return this.block(run, new AnvilError("AGENT_EXECUTION_FAILED", output.summary)); if (output.status === "needs_replan") { if (this.runs.attemptsFor(run.id, "PLAN").length >= this.deps.config.planning.maxGenerations) return this.block(run, new AnvilError("MAX_ATTEMPTS_EXCEEDED", "Maximum plan generations exceeded")); return this.transition(run, "PLAN", "IMPLEMENTATION_REPLAN_REQUESTED", { reason: output.replanReason }); }
    return this.transition(run, "CHECKS", "IMPLEMENTATION_COMPLETED", { revisionId: run.currentRevisionId });
  }

  private async executeChecks(run: RunRecord, signal: AbortSignal): Promise<RunRecord> {
    const before = await this.deps.revisions.current(); if (before.id !== run.currentRevisionId) return this.mutation(run, before.id, "CHECKS_EXTERNAL_MUTATION"); const results: CheckResult[] = [];
    for (const check of this.deps.config.checks) { const result = await this.deps.checks.run(check, { cwd: run.workspaceRoot, signal, runId: run.id, epoch: run.mutationEpoch }); results.push(result); if (check.required && result.status !== "passed" && this.deps.config.checksFailFast) break; }
    const after = await this.deps.revisions.current(); if (after.id !== before.id) return this.mutation(run, after.id, "CHECKS_EXTERNAL_MUTATION"); const artifact = await this.deps.artifacts.putJson(run.id, "checks", `artifacts/checks/epoch-${run.mutationEpoch}.json`, { revisionId: before.id, results }); const passed = this.deps.config.checks.every((check) => !check.required || results.find((result) => result.id === check.id)?.status === "passed"); const attempt = this.runs.beginAttempt(run, "CHECKS", undefined, "warden"); this.runs.finalizeAttempt(attempt, { status: "completed", resultRevisionId: before.id, verdict: passed ? "pass" : "fail", usage: { requests: 0 } });
    this.gates.save({ runId: run.id, gate: "checks", revisionId: before.id, mutationEpoch: run.mutationEpoch, configHash: run.configHash, gatePolicyHash: JSON.stringify(this.deps.config.checks), verdict: passed ? "pass" : "fail", attemptId: attempt.id, artifactId: artifact.id, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });
    if (passed) { this.findings.resolveGate(run.id, "checks", attempt.id); return this.transition(run, "SECURITY", "CHECKS_PASSED", { revisionId: before.id }); }
    for (const result of results.filter((item) => item.status !== "passed")) this.lifecycle.upsert(run.id, "checks", run.mutationEpoch, attempt, { severity: "high", category: "deterministic-check", title: `${result.id} failed`, description: result.summary, fixRequirement: `Make ${result.id} pass before requesting another gate` }); return this.transition(run, "IMPLEMENT", "CHECK_FAILED", { revisionId: before.id });
  }

  private async executeSecurity(run: RunRecord, signal: AbortSignal): Promise<RunRecord> {
    const securityAttempts = this.runs.attemptsFor(run.id, "SECURITY"); this.budget.assertRoleMayRun(run, "security", securityAttempts.length, securityAttempts.reduce((total, attempt) => total + attempt.tokens, 0)); const before = await this.deps.revisions.current(); if (before.id !== run.currentRevisionId) return this.mutation(run, before.id, "SECURITY_EXTERNAL_MUTATION"); if (!this.gates.currentPass(run.id, "checks", before.id, run.configHash, JSON.stringify(this.deps.config.checks))) return this.transition(run, "CHECKS", "STALE_CHECK_PASS_REJECTED");
    const attempt = this.runs.beginAttempt(run, "SECURITY", "security", this.deps.config.agents.security.agent); const handoff = this.context.build("security", { run, objective: this.objective(run), plan: run.planPath ? { id: "plan", path: run.planPath, sha256: "" } : undefined, findings: this.findings.list(run.id, "open"), changedFiles: await this.deps.revisions.changedFiles(run.baseRevisionId, run.currentRevisionId), evidence: [] }); await this.deps.artifacts.putJson(run.id, "handoff", `artifacts/security/handoff-${attempt.sequence}.json`, handoff.envelope, attempt.id);
    const result = await this.deps.agents.run<SecurityOutput>({ runId: run.id, attemptId: attempt.id, role: "security", agentName: this.deps.config.agents.security.agent, assignment: "Perform a read-only security review and return SecurityOutput.", context: handoff.text, outputSchema: { name: "SecurityOutput", version: 1 }, schemaMode: "strict", cwd: run.workspaceRoot, baseRevisionId: before.id, readOnly: true, signal }); const after = await this.deps.revisions.current(); this.runs.finalizeAttempt(attempt, { ...result, resultRevisionId: after.id }); if (after.id !== before.id) return this.mutation(run, after.id, "SECURITY_MUTATED_WORKSPACE", "CHECKS"); if (result.status !== "completed") throw new AnvilError("AGENT_EXECUTION_FAILED", result.error?.message ?? "Security agent failed"); const output = requireSecurity(result.structured); const artifact = await this.deps.artifacts.putJson(run.id, "security", `artifacts/security/attempt-${attempt.sequence}.json`, output, attempt.id);
    if (output.verdict === "blocked") return this.block(run, new AnvilError("AGENT_EXECUTION_FAILED", output.blockedReason ?? "Sentinel blocked"));
    let repeatedBlockingFinding = false;
    for (const finding of output.findings) {
      const persisted = this.lifecycle.upsert(run.id, "security", run.mutationEpoch, attempt, { severity: finding.severity, category: finding.category, title: finding.title, description: finding.description, fixRequirement: finding.fixRequirement, file: finding.file, lineStart: finding.lineStart, lineEnd: finding.lineEnd, symbol: finding.symbol, evidenceArtifactId: artifact.id });
      if (persisted.status === "open" && persisted.timesSeen >= 3 && this.deps.config.security.failOn.includes(finding.severity)) repeatedBlockingFinding = true;
    }
    if (repeatedBlockingFinding) return this.block(run, new AnvilError("NO_PROGRESS", "The same blocking Sentinel finding persisted across three attempts"));
    const next = nextAfterSecurity(output, this.deps.config.security.failOn); if (next === "IMPLEMENT") return this.transition(run, "IMPLEMENT", "SECURITY_FINDINGS", { revisionId: before.id }); this.findings.resolveGate(run.id, "security", attempt.id); this.gates.save({ runId: run.id, gate: "security", revisionId: before.id, mutationEpoch: run.mutationEpoch, configHash: run.configHash, gatePolicyHash: JSON.stringify(this.deps.config.security), verdict: "pass", attemptId: attempt.id, artifactId: artifact.id, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() }); return this.transition(run, "REVIEW", "SECURITY_PASSED", { revisionId: before.id });
  }

  private async report(run: RunRecord, kind: WorkflowProgressKind): Promise<void> {
    const handler = this.progress.get(run.id); if (!handler) return;
    try { await handler({ kind, run }); } catch { /* UI progress must never change workflow outcome. */ }
  }
  private async executeReview(run: RunRecord, signal: AbortSignal): Promise<RunRecord> {
    const reviewAttempts = this.runs.attemptsFor(run.id, "REVIEW"); this.budget.assertRoleMayRun(run, "review", reviewAttempts.length, reviewAttempts.reduce((total, attempt) => total + attempt.tokens, 0)); const before = await this.deps.revisions.current(); if (before.id !== run.currentRevisionId) return this.mutation(run, before.id, "REVIEW_EXTERNAL_MUTATION", "CHECKS"); if (!this.gates.currentPass(run.id, "checks", before.id, run.configHash, JSON.stringify(this.deps.config.checks)) || !this.gates.currentPass(run.id, "security", before.id, run.configHash, JSON.stringify(this.deps.config.security))) return this.transition(run, "CHECKS", "STALE_GATE_PASS_REJECTED");
    const attempt = this.runs.beginAttempt(run, "REVIEW", "review", this.deps.config.agents.review.agent); const handoff = this.context.build("review", { run, objective: this.objective(run), plan: run.planPath ? { id: "plan", path: run.planPath, sha256: "" } : undefined, findings: this.findings.list(run.id, "open"), changedFiles: await this.deps.revisions.changedFiles(run.baseRevisionId, run.currentRevisionId), evidence: [] }); await this.deps.artifacts.putJson(run.id, "handoff", `artifacts/review/handoff-${attempt.sequence}.json`, handoff.envelope, attempt.id);
    const result = await this.deps.agents.run<ReviewOutput>({ runId: run.id, attemptId: attempt.id, role: "review", agentName: this.deps.config.agents.review.agent, assignment: "Perform a read-only final engineering review and return ReviewOutput.", context: handoff.text, outputSchema: { name: "ReviewOutput", version: 1 }, schemaMode: "strict", cwd: run.workspaceRoot, baseRevisionId: before.id, readOnly: true, signal }); const after = await this.deps.revisions.current(); this.runs.finalizeAttempt(attempt, { ...result, resultRevisionId: after.id }); if (after.id !== before.id) return this.mutation(run, after.id, "REVIEW_MUTATED_WORKSPACE", "CHECKS"); if (result.status !== "completed") throw new AnvilError("AGENT_EXECUTION_FAILED", result.error?.message ?? "Review agent failed"); const output = requireReview(result.structured); const artifact = await this.deps.artifacts.putJson(run.id, "review", `artifacts/review/attempt-${attempt.sequence}.json`, output, attempt.id); for (const finding of output.findings) this.lifecycle.upsert(run.id, "review", run.mutationEpoch, attempt, { severity: finding.severity, category: finding.category, title: finding.title, description: finding.description, fixRequirement: finding.fixRequirement, file: finding.file, lineStart: finding.lineStart, lineEnd: finding.lineEnd, symbol: finding.symbol, evidenceArtifactId: artifact.id }); const next = nextAfterReview(output, this.deps.config.review.blockOn); if (next === "IMPLEMENT") return this.transition(run, "IMPLEMENT", "REVIEW_FINDINGS", { revisionId: before.id }); this.findings.resolveGate(run.id, "review", attempt.id); this.gates.save({ runId: run.id, gate: "review", revisionId: before.id, mutationEpoch: run.mutationEpoch, configHash: run.configHash, gatePolicyHash: JSON.stringify(this.deps.config.review), verdict: "pass", attemptId: attempt.id, artifactId: artifact.id, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() }); await assertCanComplete(run, { revisions: this.deps.revisions, gates: this.gates, findings: this.findings, runs: this.runs, config: this.deps.config }); const done = this.transition(run, "DONE", "RUN_DONE", { revisionId: before.id }); const lessons = this.lessons.get(run.id) ?? []; if (this.deps.memory && this.deps.config.memory.enabled && this.deps.config.memory.retainOnSuccess) await this.deps.memory.retain(lessons, done); this.lessons.delete(run.id); return done;
  }

  private transition(run: RunRecord, next: WorkflowState, type: string, payload?: unknown): RunRecord { assertLegalTransition(run.currentState, next); const updated = this.runs.update(run.id, { current_state: next, status: statusForState(next), transition_count: run.transitionCount + 1, finished_at: isTerminal(next) ? this.clock.now().toISOString() : null }, { type, stateBefore: run.currentState, stateAfter: next, revisionId: run.currentRevisionId, payload }); return updated; }
  private mutation(run: RunRecord, revisionId: string, event: string, next: WorkflowState = "CHECKS"): RunRecord { const updated = this.updateRevision(run, revisionId, event); return this.transition(updated, next, event, { revisionId }); }
  private updateRevision(run: RunRecord, revisionId: string, event?: string): RunRecord { return this.runs.update(run.id, { current_revision_id: revisionId, mutation_epoch: run.mutationEpoch + 1 }, event ? { type: "WORKSPACE_REVISION_CHANGED", stateBefore: run.currentState, stateAfter: run.currentState, revisionId, payload: { reason: event } } : undefined); }
  private block(run: RunRecord, error: AnvilError): RunRecord { return this.runs.update(run.id, { blocked_reason: error.message, failure_code: error.code, status: "blocked", current_state: "BLOCKED", finished_at: this.clock.now().toISOString(), transition_count: run.transitionCount + 1 }, { type: "RUN_BLOCKED", stateBefore: run.currentState, stateAfter: "BLOCKED", payload: { code: error.code, message: error.message } }); }
  private fail(run: RunRecord, error: AnvilError): RunRecord { return this.runs.update(run.id, { failure_code: error.code, failure_message: error.message, status: "failed", current_state: "FAILED", finished_at: this.clock.now().toISOString(), transition_count: run.transitionCount + 1 }, { type: "RUN_FAILED", stateBefore: run.currentState, stateAfter: "FAILED", payload: { code: error.code, message: error.message } }); }
  private objective(run: RunRecord): ArtifactPointer { return this.objectivePointers.get(run.id) ?? { id: "objective", path: run.objectivePath, sha256: "" }; }
  private summary(run: RunRecord): RunSummary { return { run, events: this.events.list(run.id), findings: this.findings.list(run.id), attempts: this.runs.attempts(run.id) }; }
}
