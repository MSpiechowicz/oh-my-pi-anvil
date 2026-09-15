import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./test-helpers.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { ArtifactStore } from "../src/state/artifact-store.ts";
import { StateDatabase } from "../src/state/database.ts";
import { StaticRevisionProvider } from "../src/git/revision.ts";
import { WorkflowEngine } from "../src/workflow/engine.ts";
import type { AgentRunner, AgentRunRequest, CheckRunner, HandoffEnvelope, SmithTask, WorkflowConfig } from "../src/workflow/types.ts";

const task = (id: string, ownedFiles = [`${id}.ts`], dependsOn: string[] = [], findingIds: string[] = []): SmithTask => ({
  id,
  objective: `Implement ${id}`,
  dependsOn,
  ownedFiles,
  acceptanceCriteria: [`${id} works`],
  findingIds,
});
const plan = {
  version: 1,
  summary: "Implement separate modules",
  assumptions: [],
  steps: [{
    id: "step",
    title: "Implement",
    objective: "Implement modules",
    dependsOn: [],
    fileHints: [],
    symbolHints: [],
    acceptanceCriteria: ["Works"],
    risk: "low",
    securitySurfaces: [],
  }],
  globalAcceptanceCriteria: ["Works"],
  requiredChecks: [],
  risks: [],
  replanTriggers: [],
  smithTasks: [task("implementation", [])],
};
const implementation = {
  version: 1,
  status: "completed",
  summary: "Implemented",
  claimedChangedFiles: [],
  addressedFindingIds: [],
  remainingConcerns: [],
};
const security = { version: 1, verdict: "pass", scope: { revisionId: "rev", reviewedAreas: [] }, findings: [], residualRisks: [] };
const review = {
  version: 1,
  verdict: "pass",
  acceptance: [{ criterion: "Works", status: "satisfied", evidence: "Observed" }],
  findings: [],
  notes: [],
};

async function fixture(
  invoke: (request: AgentRunRequest) => Promise<unknown>,
  configure?: (config: WorkflowConfig) => void,
  checks?: CheckRunner,
) {
  const root = await mkdtemp("/tmp/anvil-dispatch-");
  const state = await StateDatabase.open(path.join(root, ".anvil"));
  const config = structuredClone(DEFAULT_CONFIG);
  config.scouting.enabled = false;
  config.memory.enabled = false;
  config.checks = [{ id: "check", command: ["true"], required: true, timeoutMs: 1000 }];
  configure?.(config);
  const requests: AgentRunRequest[] = [];
  const agents: AgentRunner = {
    async run<T>(request: AgentRunRequest) {
      requests.push(request);
      return {
        status: "completed",
        agentName: request.agentName,
        structured: await invoke(request) as T,
        usage: { requests: 1, total: 1 },
      };
    },
  };
  const revisions = new StaticRevisionProvider({ id: "rev", head: "head", stagedSha256: "", unstagedSha256: "", untracked: [] });
  const engine = new WorkflowEngine({
    config,
    state,
    agents,
    revisions,
    artifacts: new ArtifactStore(state, (id) => path.join(root, ".anvil", "runs", id)),
    checks: checks ?? {
      async run(check) {
        return { id: check.id, status: "passed", durationMs: 0, summary: "Passed" };
      },
    },
  });
  return {
    engine,
    requests,
    revisions,
    root,
    state,
    config,
    async close() {
      state.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

function barrier() {
  const { promise, resolve: release } = Promise.withResolvers<void>();
  return { promise, release };
}

test("a plan without an explicit dispatch cannot start a fallback Smith", async () => {
  const { smithTasks: _smithTasks, ...omitted } = plan;
  const f = await fixture(async () => omitted);
  try {
    const result = await f.engine.start({ objective: "Require an explicit work decomposition", workspaceRoot: f.root });
    expect(result.run.failureCode).toBe("SCHEMA_INVALID");
    expect(result.attempts.filter((attempt) => attempt.role === "implementation")).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("independent Smiths overlap, dependencies wait, and gates see the complete batch", async () => {
  const joined = barrier();
  let started = 0;
  let finished = 0;
  let checkCalls = 0;
  const f = await fixture(
    async (request) => {
      if (request.role === "planner") return { ...plan, smithTasks: [task("a"), task("b"), task("c", ["c.ts"], ["a", "b"])] };
      if (request.role === "implementation") {
        const ordinal = ++started;
        if (ordinal <= 2) {
          if (ordinal === 2) joined.release();
          await joined.promise;
        } else expect(finished).toBe(2);
        finished++;
        return {
          ...implementation,
          summary: `Completed worker ${ordinal}`,
          verification: [{ criterion: `worker ${ordinal}`, status: "not_run", evidence: "Deferred until barrier" }],
        };
      }
      expect(finished).toBe(3);
      return request.role === "security" ? security : review;
    },
    undefined,
    {
      async run(check) {
        checkCalls++;
        expect(finished).toBe(3);
        return { id: check.id, status: "passed", durationMs: 0, summary: "Complete batch" };
      },
    },
  );
  try {
    const result = await f.engine.start({ objective: "Parallel modules then integration", workspaceRoot: f.root });
    expect(result.run.currentState).toBe("DONE");
    expect(result.attempts.filter((a) => a.role === "implementation")).toHaveLength(3);
    expect(checkCalls).toBe(1);
    const reviewRequest = f.requests.find((r) => r.role === "review")!;
    const handoff = JSON.parse(reviewRequest.context!) as HandoffEnvelope;
    const claims = handoff.evidence!.find((e) => e.kind === "smith-implementation-claims")!;
    const evidence = JSON.parse(await readFile(claims.artifact.path, "utf8"));
    expect(evidence.output.verification.map((entry: { criterion: string }) => entry.criterion).sort()).toEqual([
      "worker 1",
      "worker 2",
      "worker 3",
    ]);
  } finally {
    await f.close();
  }
});

for (const mode of ["overlap", "exclusive", "limit", "isolated"] as const) {
  test(`Smith dispatch serializes ${mode} work`, async () => {
    let active = 0;
    let peak = 0;
    const tasks = mode === "overlap"
      ? [task("a", ["src"]), task("b", ["src/b.ts"])]
      : mode === "exclusive"
      ? [task("a", []), task("b")]
      : [task("a"), task("b")];
    const f = await fixture(async (request) => {
      if (request.role === "planner") return { ...plan, smithTasks: tasks };
      if (request.role === "implementation") {
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        active--;
        return implementation;
      }
      return request.role === "security" ? security : review;
    }, (config) => {
      if (mode === "limit") config.implementation.maxParallel = 1;
      if (mode === "isolated") config.implementation.isolation.enabled = true;
    });
    try {
      const result = await f.engine.start({ objective: "Respect task boundaries", workspaceRoot: f.root });
      expect(result.run.currentState).toBe("DONE");
      expect(peak).toBe(1);
      expect(result.attempts.filter((a) => a.role === "implementation")).toHaveLength(2);
    } finally {
      await f.close();
    }
  });
}

for (const gate of ["checks", "security", "review"] as const) {
  test(`${gate} repairs can fan out to multiple Smiths`, async () => {
    let gateCalls = 0;
    let smithCalls = 0;
    let plannerCalls = 0;
    const joined = barrier();
    const finding = {
      severity: gate === "security" ? "high" : "major",
      category: "correctness",
      title: "Broken module",
      description: "Module rejects valid input",
      evidence: "Observed failure",
      fixRequirement: "Accept valid input",
      ...(gate === "security" ? { exploitOrImpact: "Incorrect rejection", confidence: "high" } : {}),
    };
    const f = await fixture(
      async (request) => {
        if (request.role === "planner") {
          plannerCalls++;
          const schema = request.outputSchema;
          if (!schema || typeof schema !== "object" || !("title" in schema) || schema.title !== "SmithDispatchOutput") return plan;
          const handoff = JSON.parse(request.context!) as HandoffEnvelope;
          const ids = handoff.openFindings!.map((item) => item.id);
          return { version: 1, tasks: [task("repair-a", ["a.ts"], [], ids), task("repair-b", ["b.ts"], [], ids)] };
        }
        if (request.role === "implementation") {
          smithCalls++;
          if (smithCalls > 1) {
            if (smithCalls === 3) joined.release();
            await joined.promise;
          }
          return implementation;
        }
        if (request.role === gate && ++gateCalls === 1) {
          const base = gate === "security" ? security : review;
          return {
            ...base,
            verdict: "findings",
            findings: [finding],
            smithTasks: [task("repair-a", ["a.ts"], [], ["0"]), task("repair-b", ["b.ts"], [], ["0"])],
          };
        }
        return request.role === "security" ? security : review;
      },
      undefined,
      {
        async run(check) {
          const failed = gate === "checks" && ++gateCalls === 1;
          return { id: check.id, status: failed ? "failed" : "passed", durationMs: 0, summary: failed ? "Modules failed" : "Passed" };
        },
      },
    );
    try {
      const result = await f.engine.start({ objective: "Repair independent modules", workspaceRoot: f.root });
      expect(result.run.currentState).toBe("DONE");
      expect(smithCalls).toBe(3);
      expect(plannerCalls).toBe(gate === "checks" ? 2 : 1);
      expect(result.findings.every((item) => item.status === "resolved")).toBe(true);
    } finally {
      await f.close();
    }
  });
}

test("a blocked Smith cannot be hidden by a sibling source mutation", async () => {
  const joined = barrier();
  let calls = 0;
  let gateCalls = 0;
  const f = await fixture(
    async (request) => {
      if (request.role === "planner") return { ...plan, smithTasks: [task("a"), task("b")] };
      if (request.role === "implementation") {
        if (++calls === 1) {
          await joined.promise;
          return { ...implementation, status: "blocked", summary: "Missing prerequisite" };
        }
        f.revisions.set({ id: "changed", head: "head", stagedSha256: "changed", unstagedSha256: "", untracked: [] });
        joined.release();
        return implementation;
      }
      return request.role === "security" ? security : review;
    },
    undefined,
    {
      async run(check) {
        gateCalls++;
        return { id: check.id, status: "passed", durationMs: 0, summary: "Passed" };
      },
    },
  );
  try {
    const result = await f.engine.start({ objective: "Never seal partial work", workspaceRoot: f.root });
    expect(result.run.currentState).toBe("BLOCKED");
    expect(result.run.currentRevisionId).toBe("changed");
    expect(gateCalls).toBe(0);
    expect(result.attempts.some((a) => a.status === "running")).toBe(false);
  } finally {
    await f.close();
  }
});

test("Smith fan-out respects the shared attempt budget before starting excess workers", async () => {
  let smithCalls = 0;
  let gateCalls = 0;
  const f = await fixture(async (request) => {
    if (request.role === "planner") return { ...plan, smithTasks: [task("a"), task("b")] };
    if (request.role === "implementation") {
      smithCalls++;
      return implementation;
    }
    return request.role === "security" ? security : review;
  }, (config) => {
    config.budgets.perRole.implementation = { maxAttempts: 1 };
  }, {
    async run(check) {
      gateCalls++;
      return { id: check.id, status: "passed", durationMs: 0, summary: "Passed" };
    },
  });
  try {
    const result = await f.engine.start({ objective: "Bound every worker", workspaceRoot: f.root });
    expect(result.run.currentState).toBe("BLOCKED");
    expect(result.run.failureCode).toBe("MAX_ATTEMPTS_EXCEEDED");
    expect(smithCalls).toBeLessThanOrEqual(1);
    expect(gateCalls).toBe(0);
    expect(result.attempts.some((a) => a.status === "running")).toBe(false);
  } finally {
    await f.close();
  }
});

test("repair dispatch cannot omit an open finding", async () => {
  let smithCalls = 0;
  let checkCalls = 0;
  const f = await fixture(
    async (request) => {
      if (request.role === "planner") {
        const schema = request.outputSchema;
        return schema && typeof schema === "object" && "title" in schema && schema.title === "SmithDispatchOutput"
          ? { version: 1, tasks: [task("incomplete")] }
          : plan;
      }
      if (request.role === "implementation") {
        smithCalls++;
        return implementation;
      }
      return request.role === "security" ? security : review;
    },
    undefined,
    {
      async run(check) {
        checkCalls++;
        return { id: check.id, status: "failed", durationMs: 0, summary: "Required behavior still broken" };
      },
    },
  );
  try {
    const result = await f.engine.start({ objective: "Keep all repair obligations", workspaceRoot: f.root });
    expect(result.run.currentState).toBe("FAILED");
    expect(result.run.failureCode).toBe("SCHEMA_INVALID");
    expect(smithCalls).toBe(1);
    expect(checkCalls).toBe(1);
    expect(result.findings.filter((finding) => finding.status === "open")).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("cancelling a Smith batch drains children without entering gates", async () => {
  const joined = barrier();
  let smithCalls = 0;
  let returned = 0;
  let gateCalls = 0;
  const f = await fixture(
    async (request) => {
      if (request.role === "planner") return { ...plan, smithTasks: [task("a"), task("b")] };
      if (request.role === "implementation") {
        const ordinal = ++smithCalls;
        if (ordinal === 2) joined.release();
        await joined.promise;
        if (ordinal === 1) await f.engine.cancel(request.runId);
        returned++;
        return implementation;
      }
      return request.role === "security" ? security : review;
    },
    undefined,
    {
      async run(check) {
        gateCalls++;
        return { id: check.id, status: "passed", durationMs: 0, summary: "Passed" };
      },
    },
  );
  try {
    const result = await f.engine.start({ objective: "Cancel all concurrent work", workspaceRoot: f.root });
    expect(result.run.currentState).toBe("CANCELLED");
    expect(returned).toBe(2);
    expect(gateCalls).toBe(0);
    expect(result.attempts.some((attempt) => attempt.status === "running")).toBe(false);
  } finally {
    await f.close();
  }
});

test("resuming a partial dispatch replans unfinished work rather than skipping to gates", async () => {
  const completed: string[] = [];
  let checks = 0;
  let recoveryPlans = 0;
  const f = await fixture(async (request) => {
    if (request.role === "planner") {
      const schema = request.outputSchema;
      if (schema && typeof schema === "object" && "title" in schema && schema.title === "SmithDispatchOutput") {
        recoveryPlans++;
        const handoff = JSON.parse(request.context!) as HandoffEnvelope;
        expect(handoff.evidence!.some((entry) => entry.kind === "interrupted-smith-history-not-current-proof")).toBe(true);
        return { version: 1, tasks: [task("b")] };
      }
      return { ...plan, smithTasks: [task("a"), task("b")] };
    }
    if (request.role === "implementation") {
      const handoff = JSON.parse(request.context!) as HandoffEnvelope;
      const pointer = handoff.evidence!.find((entry) => entry.kind === "smith-task")!.artifact;
      const assignment = JSON.parse(await readFile(pointer.path, "utf8"));
      completed.push(assignment.task.id);
      f.revisions.set({ id: `revision-${completed.length}`, head: "head", stagedSha256: "", unstagedSha256: "", untracked: [] });
      return implementation;
    }
    return request.role === "security" ? security : review;
  }, (config) => {
    config.budgets.perRole.implementation = { maxAttempts: 1 };
  }, {
    async run(check) {
      checks++;
      expect(completed).toEqual(["a", "b"]);
      return { id: check.id, status: "passed", durationMs: 0, summary: "Whole objective verified" };
    },
  });
  try {
    const paused = await f.engine.start({ objective: "Complete work after a budget pause", workspaceRoot: f.root });
    expect(paused.run.currentState).toBe("BLOCKED");
    expect(completed).toEqual(["a"]);
    expect(checks).toBe(0);
    f.config.budgets.perRole.implementation = { maxAttempts: 2 };
    const resumed = await f.engine.resume(paused.run.id);
    expect(resumed.run.currentState).toBe("DONE");
    expect(completed).toEqual(["a", "b"]);
    expect(recoveryPlans).toBe(1);
    expect(checks).toBe(1);
  } finally {
    await f.close();
  }
});

test("unlimited Smith attempts still run in bounded waves of four", async () => {
  const joined = barrier();
  let started = 0;
  let active = 0;
  let peak = 0;
  const completed: number[] = [];
  const f = await fixture(async (request) => {
    if (request.role === "planner") return { ...plan, smithTasks: Array.from({ length: 9 }, (_, index) => task(`module-${index}`)) };
    if (request.role === "implementation") {
      const ordinal = started++;
      active++;
      peak = Math.max(peak, active);
      if (ordinal < 4) {
        if (ordinal === 3) joined.release();
        await joined.promise;
      }
      active--;
      completed.push(ordinal);
      return implementation;
    }
    expect(completed.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    return request.role === "security" ? security : review;
  });
  try {
    const result = await f.engine.start({ objective: "Finish nine independent modules without unlimited concurrency", workspaceRoot: f.root });
    expect(result.run.currentState).toBe("DONE");
    expect(peak).toBe(4);
    expect(result.attempts.filter((attempt) => attempt.role === "implementation")).toHaveLength(9);
  } finally {
    await f.close();
  }
});

test("nullable plan generations allow replanning beyond old caps while explicit generations stop", async () => {
  for (const maxGenerations of [null, 2]) {
    let implementations = 0;
    const f = await fixture(async (request) => {
      if (request.role === "planner") return { ...plan, smithTasks: [task(`generation-${implementations}`)] };
      if (request.role === "implementation") {
        implementations++;
        return implementations < 9
          ? { ...implementation, status: "needs_replan", replanReason: `Newly discovered dependency ${implementations}` }
          : implementation;
      }
      return request.role === "security" ? security : review;
    }, (config) => { config.planning.maxGenerations = maxGenerations; });
    try {
      const result = await f.engine.start({ objective: "Replan until dependencies are understood", workspaceRoot: f.root });
      expect(result.run.currentState).toBe(maxGenerations === null ? "DONE" : "BLOCKED");
      expect(result.attempts.filter((attempt) => attempt.role === "planner")).toHaveLength(maxGenerations ?? 9);
      expect(implementations).toBe(maxGenerations ?? 9);
      if (maxGenerations !== null) expect(result.run.failureCode).toBe("MAX_ATTEMPTS_EXCEEDED");
    } finally {
      await f.close();
    }
  }
});
