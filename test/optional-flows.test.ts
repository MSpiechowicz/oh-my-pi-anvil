import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./test-helpers.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { WorkflowEngine } from "../src/workflow/engine.ts";
import { StateDatabase } from "../src/state/database.ts";
import { ArtifactStore } from "../src/state/artifact-store.ts";
import { StaticRevisionProvider } from "../src/git/revision.ts";
import type { AgentRunner, AgentRunRequest, MemoryAdapter, WorkflowConfig } from "../src/workflow/types.ts";

const plan = {
  version: 1,
  summary: "Change",
  assumptions: [],
  steps: [{
    id: "one",
    title: "Change",
    objective: "Change",
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
};
const lesson = { content: "Repository migrations must preserve existing rows.", importance: 0.8 };
const outputs: Record<string, unknown> = {
  scout: {
    version: 1,
    summary: "Inspect migrations",
    areas: [{ path: "src/migrations.ts", findings: "Migrations run transactionally" }],
    risks: [],
    recommendations: ["Preserve existing rows"],
  },
  planner: plan,
  implementation: {
    version: 1,
    status: "completed",
    summary: "Changed",
    claimedChangedFiles: [],
    addressedFindingIds: [],
    remainingConcerns: [],
    durableLessons: [lesson],
  },
  security: { version: 1, verdict: "pass", scope: { revisionId: "rev", reviewedAreas: [] }, findings: [], residualRisks: [] },
  review: {
    version: 1,
    verdict: "pass",
    acceptance: [{ criterion: "Works", status: "satisfied", evidence: "Checked" }],
    findings: [],
    notes: [],
  },
  archivist: { version: 1, lessons: [lesson] },
};

async function fixture(
  configure?: (config: WorkflowConfig) => void,
  invoke?: (request: AgentRunRequest, revisions: StaticRevisionProvider) => Promise<unknown>,
  memory?: MemoryAdapter,
) {
  const root = await mkdtemp("/tmp/anvil-optional-");
  const config = structuredClone(DEFAULT_CONFIG);
  config.checks = [{ id: "check", command: ["true"], required: true, timeoutMs: 1000 }];
  configure?.(config);
  const state = await StateDatabase.open(path.join(root, ".anvil"));
  const artifacts = new ArtifactStore(state, (id) => path.join(root, ".anvil", "runs", id));
  const revisions = new StaticRevisionProvider({ id: "rev", head: "head", stagedSha256: "", unstagedSha256: "", untracked: [] });
  const requests: AgentRunRequest[] = [];
  const agents: AgentRunner = {
    async run<T>(request: AgentRunRequest) {
      requests.push(request);
      const structured = invoke ? await invoke(request, revisions) : outputs[request.role];
      return { status: "completed", agentName: request.agentName, structured: structured as T, usage: { total: 1, requests: 1 } };
    },
  };
  const engine = new WorkflowEngine({
    config,
    state,
    artifacts,
    revisions,
    agents,
    memory,
    checks: {
      async run(check) {
        return { id: check.id, status: "passed", durationMs: 0, summary: "Passed" };
      },
    },
  });
  return {
    root,
    config,
    state,
    artifacts,
    revisions,
    agents,
    requests,
    engine,
    async close() {
      state.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("optional specialists provide persisted reconnaissance and curate only after verification", async () => {
  const retained: unknown[] = [];
  const f = await fixture((config) => {
    config.planning.maxAttempts = 1;
    config.budgets.perRole.planner = { maxAttempts: 1 };
    config.review.maxAttempts = 1;
  }, async (request) => {
    const context = JSON.parse(request.context!);
    if (request.role === "planner") {
      const pointer = context.evidence.find((item: { kind: string }) => item.kind === "scout-reconnaissance").artifact;
      expect(JSON.parse(await readFile(pointer.path, "utf8"))).toEqual(outputs.scout);
      expect(context.memory).toEqual([{ content: "Use transactions." }]);
    }
    if (request.role === "archivist") {
      expect(context.evidence.some((item: { kind: string }) => item.kind === "current-check-results")).toBe(true);
      expect(context.evidence.some((item: { kind: string }) => item.kind === "smith-implementation-claims")).toBe(true);
    }
    return outputs[request.role];
  }, {
    async recall() {
      return [{ content: "Use transactions." }];
    },
    async retain(lessons, run) {
      expect(run.currentState).toBe("DONE");
      retained.push(...lessons);
    },
  });
  try {
    const result = await f.engine.start({ objective: "Change safely", workspaceRoot: f.root });
    expect(result.run.currentState).toBe("DONE");
    expect(f.requests.map((request) => request.role)).toEqual(["scout", "planner", "implementation", "security", "review", "archivist"]);
    expect(result.run.usedRequests).toBe(6);
    expect(retained).toEqual([lesson]);
  } finally {
    await f.close();
  }
});

test("optional failures and unavailable memory cannot fail verified work", async () => {
  const f = await fixture(undefined, async (request) => {
    if (request.role === "scout" || request.role === "archivist") throw new Error("Provider unavailable");
    return outputs[request.role];
  }, {
    async recall() {
      throw new Error("Memory offline");
    },
    async retain() {
      throw new Error("Memory offline");
    },
  });
  try {
    const result = await f.engine.start({ objective: "Change safely", workspaceRoot: f.root });
    expect(result.run.currentState).toBe("DONE");
    expect(result.attempts.filter((attempt) => attempt.role === "scout" || attempt.role === "archivist").map((attempt) => attempt.status))
      .toEqual(["failed", "failed"]);
  } finally {
    await f.close();
  }
});

test("Scout source mutation fails before implementation", async () => {
  const f = await fixture(undefined, async (request, revisions) => {
    if (request.role === "scout") revisions.set({ id: "mutated", head: "head", stagedSha256: "", unstagedSha256: "", untracked: [] });
    return outputs[request.role];
  });
  try {
    const result = await f.engine.start({ objective: "Change safely", workspaceRoot: f.root });
    expect(result.run.currentState).toBe("FAILED");
    expect(result.run.failureCode).toBe("READ_ONLY_GATE_MUTATED_WORKSPACE");
    expect(f.requests.map((request) => request.role)).toEqual(["scout"]);
  } finally {
    await f.close();
  }
});

test("Archivist source mutation invalidates all gates and never retains stale lessons", async () => {
  const retained: unknown[] = [];
  const f = await fixture(undefined, async (request, revisions) => {
    if (request.role === "archivist") revisions.set({ id: "mutated", head: "head", stagedSha256: "", unstagedSha256: "", untracked: [] });
    return outputs[request.role];
  }, {
    async recall() {
      return [];
    },
    async retain(lessons) {
      retained.push(...lessons);
    },
  });
  try {
    const result = await f.engine.start({ objective: "Change safely", workspaceRoot: f.root });
    expect(result.run.currentState).toBe("DONE");
    expect(result.run.mutationEpoch).toBe(1);
    expect(f.requests.map((request) => request.role)).toEqual([
      "scout",
      "planner",
      "implementation",
      "security",
      "review",
      "archivist",
      "security",
      "review",
    ]);
    expect(retained).toEqual([]);
  } finally {
    await f.close();
  }
});

test("persisted Smith lessons survive engine replacement and retention errors remain advisory", async () => {
  const retained: unknown[] = [];
  const f = await fixture((config) => {
    config.scouting.enabled = false;
    config.memory.archivist = false;
    config.budgets.maxTotalRequests = 2;
  });
  try {
    const blocked = await f.engine.start({ objective: "Change safely", workspaceRoot: f.root });
    expect(blocked.run.currentState).toBe("BLOCKED");
    f.config.budgets.maxTotalRequests = 20;
    const recovered = new WorkflowEngine({
      config: f.config,
      state: f.state,
      artifacts: f.artifacts,
      revisions: f.revisions,
      agents: f.agents,
      checks: {
        async run(check) {
          return { id: check.id, status: "passed", durationMs: 0, summary: "Passed" };
        },
      },
      memory: {
        async recall() {
          return [];
        },
        async retain(lessons) {
          retained.push(...lessons);
          throw new Error("Save unavailable");
        },
      },
    });
    const result = await recovered.resume(blocked.run.id);
    expect(result.run.currentState).toBe("DONE");
    expect(retained).toEqual([lesson]);
  } finally {
    await f.close();
  }
});

test("Scout usage blocks planning at the budget boundary and is reused after resume", async () => {
  const f = await fixture((config) => {
    config.budgets.maxTotalRequests = 1;
  });
  try {
    const blocked = await f.engine.start({ objective: "Change safely", workspaceRoot: f.root });
    expect(blocked.run.currentState).toBe("BLOCKED");
    expect(f.requests.map((request) => request.role)).toEqual(["scout"]);
    f.config.budgets.maxTotalRequests = 20;
    const completed = await f.engine.resume(blocked.run.id);
    expect(completed.run.currentState).toBe("DONE");
    expect(f.requests.filter((request) => request.role === "scout").length).toBe(1);
  } finally {
    await f.close();
  }
});

test("Scout and Archivist can be disabled independently without skipping verification", async () => {
  for (const disabled of ["scout", "archivist"] as const) {
    const f = await fixture((config) => {
      if (disabled === "scout") config.scouting.enabled = false;
      else config.memory.archivist = false;
    });
    try {
      const result = await f.engine.start({ objective: "Change safely", workspaceRoot: f.root });
      expect(result.run.currentState).toBe("DONE");
      expect(f.requests.map((request) => request.role)).toEqual(
        ["scout", "planner", "implementation", "security", "review", "archivist"].filter((role) => role !== disabled),
      );
    } finally {
      await f.close();
    }
  }
});
