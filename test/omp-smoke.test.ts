import { describe, expect, test } from "./test-helpers.ts";
import { createOmpCompat, resolveAgentSettings } from "../src/runners/omp-compat.ts";
import { OmpSubprocessRunner } from "../src/runners/omp-subprocess-runner.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { runProcess } from "../src/runners/process.ts";

const request = {
  runId: "run",
  attemptId: "attempt",
  role: "planner" as const,
  agentName: "architect",
  assignment: "check",
  context: "handoff",
  outputSchema: {},
  schemaMode: "strict" as const,
  cwd: "/tmp",
  baseRevisionId: "wr1:none",
  readOnly: true,
};
function hasUnsafeTools(options: unknown): boolean {
  if (!options || typeof options !== "object" || Array.isArray(options) || !("agent" in options)) return false;
  const agent = options.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent) || !("tools" in agent)) return false;
  return Array.isArray(agent.tools) && agent.tools.some((tool) => tool === "lsp" || tool === "bash");
}

function hasIsolatedHandoff(params: unknown): boolean {
  if (!params || typeof params !== "object" || Array.isArray(params)) return false;
  if (!("isolated" in params) || params.isolated !== true || !("task" in params) || typeof params.task !== "string") return false;
  return params.task.includes("handoff");
}


describe("OMP adapter", () => {
  test("records each child request by its serving model without counting result totals twice", async () => {
    for (const isolated of [false, true]) {
      const entries: Array<Record<string, unknown>> = [];
      let sessionId = "origin";
      const manager = {
        getSessionId: () => sessionId,
        getLeafId: () => "branch",
        appendModelUsage(entry: Record<string, unknown>, target: { sessionId: string; parentId: string }) {
          if (target.sessionId === sessionId && target.parentId === "branch") entries.push(entry);
        },
      };
      type Bus = { emit: (name: string, payload: unknown) => void };
      let bus: Bus;
      const usage = {
        input: 2, output: 3, cacheRead: 5, cacheWrite: 7, totalTokens: 17,
        cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
      };
      const finish = () => {
        for (const [provider, model, stopReason] of [["first", "original", "error"], ["second", "fallback", "stop"]]) {
          const message = { role: "assistant", provider, model, stopReason, usage };
          bus.emit("task:subagent:event", { event: { type: "message_update", message } });
          bus.emit("task:subagent:event", { event: { type: "message_end", message } });
          bus.emit("task:subagent:event", { event: { type: "agent_end", messages: [message] } });
        }
        bus.emit("task:subagent:event", { event: { type: "message_end", message: { role: "toolResult", usage } } });
        return { exitCode: 1, aborted: true, usage: { ...usage, totalTokens: 34 } };
      };
      const compat = createOmpCompat({ sessionManager: manager }, {
        Settings: { loadReadOnly: () => ({ get: () => ({}), override: () => {} }) },
        discoverAgents: () => ({ agents: [{ name: "architect", tools: ["read"] }] }),
        runSubprocess: (options: { eventBus: Bus }) => { bus = options.eventBus; return finish(); },
        TaskTool: { create: (session: { eventBus: Bus }) => {
          bus = session.eventBus;
          return { execute: () => ({ details: { results: [finish()] } }) };
        } },
      });
      const result = await compat.execute!({ ...request, ...(isolated ? { isolation: { requested: true, apply: true, merge: "patch" as const } } : {}) });
      expect(result.status).toBe("aborted");
      expect(entries).toEqual([
        { purpose: "forge", provider: "first", model: "original", usage },
        { purpose: "forge", provider: "second", model: "fallback", usage },
      ]);
      sessionId = "another-session";
      bus!.emit("task:subagent:event", { event: {
        type: "message_end", message: { role: "assistant", provider: "late", model: "response", usage },
      } });
      expect(entries.length).toBe(2);
    }
  });

  test("concurrent Smiths retain interleaved usage across models and sibling cancellation", async () => {
    const entries: Array<{ model: string; usage: { totalTokens: number } }> = [];
    const joined = Promise.withResolvers<void>();
    const firstFinished = Promise.withResolvers<void>();
    let started = 0;
    const compat = createOmpCompat({
      sessionManager: {
        getSessionId: () => "smith-batch",
        getLeafId: () => "origin",
        appendModelUsage(entry: { model: string; usage: { totalTokens: number } }) { entries.push(entry); },
      },
    }, {
      Settings: { loadReadOnly: () => ({ get: () => ({}), override: () => {} }) },
      discoverAgents: () => ({ agents: [{ name: "smith", tools: ["read", "edit"] }] }),
      async runSubprocess(options: { id: string; eventBus: { emit: (name: string, payload: unknown) => void } }) {
        const emit = (model: string, totalTokens: number) => {
          options.eventBus.emit("task:subagent:event", { id: options.id, event: {
            type: "message_end",
            message: { role: "assistant", provider: "provider", model,
              usage: { input: totalTokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
          } });
        };
        emit("shared-model", options.id === "smith-a" ? 10 : 20);
        if (++started === 2) joined.resolve();
        await joined.promise;
        if (options.id === "smith-a") {
          emit("fallback-model", 30);
          firstFinished.resolve();
          return { exitCode: 0, structuredOutput: { status: "valid", data: { completed: true } },
            usage: { totalTokens: 40 } };
        }
        await firstFinished.promise;
        emit("shared-model", 40);
        return { exitCode: 1, aborted: true, usage: { totalTokens: 60 } };
      },
    });
    const runner = new OmpSubprocessRunner(compat);
    const results = await Promise.all(["smith-a", "smith-b"].map((attemptId) => runner.run({
      ...request, attemptId, role: "implementation", agentName: "smith", readOnly: false,
    })));
    expect(results.map((result) => result.status)).toEqual(["completed", "aborted"]);
    const totals: Record<string, number> = {};
    for (const entry of entries) totals[entry.model] = (totals[entry.model] ?? 0) + entry.usage.totalTokens;
    expect(totals).toEqual({ "shared-model": 70, "fallback-model": 30 });
    expect(entries.length).toBe(4);
  });

  test("retains unresolved inheritance as null in the effective snapshot", async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    await resolveAgentSettings(config, "/tmp", {});
    const saved = JSON.parse(JSON.stringify(config));
    expect(saved.agents.planner).toEqual({ agent: "architect", model: null, thinkingLevel: null, effort: null });
  });

  test("snapshots global role models and thinking without overriding manual settings", async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.agents.implementation.model = "manual/model:low";
    config.agents.implementation.thinkingLevel = "off";
    const values: Record<string, unknown> = {
      modelRoles: { architect: "@slow", slow: "global/planner:high", default: "global/default" },
      "task.agentModelOverrides": { sentinel: "global/security:medium" },
      defaultThinkingLevel: "xhigh",
    };
    await resolveAgentSettings(config, "/tmp", {}, {
      Settings: { loadReadOnly: () => ({ get: (key: string) => values[key] }) },
      discoverAgents: () => ({ agents: [{ name: "architect", model: "@architect" }] }),
    });
    expect(config.agents.planner).toEqual({ agent: "architect", model: "global/planner", thinkingLevel: "high", effort: null });
    expect(config.agents.implementation).toEqual({ agent: "smith", model: "manual/model", thinkingLevel: "off", effort: null });
    expect(config.agents.security).toEqual({ agent: "sentinel", model: "global/security", thinkingLevel: "medium", effort: null });
    expect(config.agents.review).toEqual({ agent: "inquisitor", model: "global/default", thinkingLevel: "xhigh", effort: null });
    values.defaultThinkingLevel = "low";
    await resolveAgentSettings(config, "/tmp", { settings: { get: (key: string) => values[key] } });
    expect(config.agents.review.thinkingLevel).toBe("xhigh");
  });

  test("explicit thinking overrides model suffixes in subprocess and isolated execution", async () => {
    const configured = { ...request, model: "provider/model:high", thinkingLevel: "off" };
    const resultFor = (model: unknown) => ({
      exitCode: model === "provider/model:off" ? 0 : 1,
      structuredOutput: { status: "valid", data: { accepted: true } },
      error: model === "provider/model:off" ? undefined : "Thinking override lost",
    });
    const compat = createOmpCompat({}, {
      Settings: { loadReadOnly: () => ({ get: () => ({}), override: () => {} }) },
      discoverAgents: () => ({ agents: [{ name: "architect", tools: ["read"] }] }),
      runSubprocess: (options: { modelOverride?: string }) => resultFor(options.modelOverride),
      TaskTool: { create: () => ({ execute: (_id: string, params: { model?: string }) => resultFor(params.model) }) },
    });
    expect((await compat.execute!(configured)).status).toBe("completed");
    expect((await compat.execute!({ ...configured, isolation: { requested: true, apply: true, merge: "patch" } })).status).toBe("completed");
  });

  test("fails clearly when no host executor is available", async () => {
    const runner = new OmpSubprocessRunner({});
    const result = await runner.run({ ...request, agentName: "missing" });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("OMP_EXECUTOR_UNAVAILABLE");
  });

  test("bridges the host SDK subprocess API and preserves structured output", async () => {
    const compat = createOmpCompat(
      { model: { provider: "test", id: "model" } },
      {
        Settings: {
          loadReadOnly: async () => ({
            get: () => [],
            override: () => {},
          }),
        },
        discoverAgents: async () => ({
          agents: [{
            name: "architect",
            source: "project",
            description: "test architect",
            systemPrompt: "read only",
            tools: ["read", "lsp", "bash"],
          }],
        }),
        runSubprocess: async (options: unknown) => {
          if (hasUnsafeTools(options)) {
            return {
              agent: "architect",
              exitCode: 1,
              output: "",
              stderr: "unsafe tool exposed",
              error: "read-only policy violation",
            };
          }
          return {
            agent: "architect",
            exitCode: 0,
            output: "",
            stderr: "",
            structuredOutput: { status: "valid", data: { version: 1 } },
            usage: { input: 2, output: 3, totalTokens: 10 },
            requests: 1,
            durationMs: 12,
          };
        },
      },
    );

    const result = await compat.execute!({ ...request });

    expect(result.status).toBe("completed");
    expect(result.structured).toEqual({ version: 1 });
    expect(result.usage.total).toBe(10);
  });

  test("allows reviewer validation capabilities without exposing source edit tools or expanding planner access", async () => {
    for (const role of ["planner", "security", "review"] as const) {
      const configured = ["read", "bash", "eval", "github", "write", "edit", "ast_edit", "task"];
      const compat = createOmpCompat({}, {
        Settings: { loadReadOnly: () => ({ get: () => [], override: () => {} }) },
        discoverAgents: () => ({ agents: [{ name: role, tools: configured }] }),
        runSubprocess: (options: { agent: { tools: string[] } }) => {
          const allowed = new Set(options.agent.tools);
          const denied = ["write", "edit", "ast_edit", "task"];
          const validation = ["bash", "eval", "github"];
          if (denied.some((name) => allowed.has(name)) ||
            validation.some((name) => allowed.has(name) !== (role !== "planner"))) {
            return { exitCode: 1, error: "Role capability boundary violated" };
          }
          return { exitCode: 0, structuredOutput: { status: "valid", data: { inspected: role } } };
        },
      });
      const result = await compat.execute!({ ...request, role, agentName: role });
      expect(result.status).toBe("completed");
      expect(result.structured).toEqual({ inspected: role });
    }
  });

  test("uses TaskTool for isolated implementation requests", async () => {
    const compat = createOmpCompat(
      {},
      {
        Settings: {
          loadReadOnly: async () => ({
            get: () => [],
            override: () => {},
          }),
        },
        discoverAgents: async () => ({ agents: [] }),
        TaskTool: {
          create: async () => ({
            execute: async (_id: string, params: unknown) => {
              if (!hasIsolatedHandoff(params)) {
                return {
                  details: {
                    results: [{
                      agent: "smith",
                      exitCode: 1,
                      output: "",
                      stderr: "isolated handoff missing",
                    }],
                  },
                };
              }
              return {
                details: {
                  results: [{
                    agent: "smith",
                    exitCode: 0,
                    output: "",
                    stderr: "",
                    structuredOutput: { status: "valid", data: { version: 1 } },
                    usage: { totalTokens: 4 },
                    requests: 1,
                    durationMs: 8,
                  }],
                },
              };
            },
          }),
        },
      },
    );

    const result = await compat.execute!({
      ...request,
      role: "implementation",
      agentName: "smith",
      readOnly: false,
      isolation: { requested: true, apply: true, merge: "patch" },
    });

    expect(result.status).toBe("completed");
    expect(result.structured).toEqual({ version: 1 });
  });

  test("does not infer thinking metadata from configured or display model suffixes on failed tasks", async () => {
    let resolvedThinkingLevel: string | undefined = undefined;
    const compat = createOmpCompat({ model: { provider: "parent", id: "configured" } }, {
      Settings: { loadReadOnly: async () => ({ get: () => "high", override: () => {} }) },
      TaskTool: { create: async () => ({
        execute: async () => ({ details: { results: [{
          agent: "smith", exitCode: 1, aborted: true, error: "Cancelled after model fallback",
          resolvedModel: "serving/model:high",
          resolvedThinkingLevel,
          modelOverride: "configured/model:low",
        }] } }),
      }) },
    });
    const result = await compat.execute!({ ...request, readOnly: false, isolation: { requested: true, apply: true, merge: "patch" } });
    expect(result.status).toBe("aborted");
    expect(result.resolvedModel).toBe("serving/model:high");
    expect(result.resolvedThinkingLevel).toBe(null);
    expect(result.durationMs).toBe(undefined);
    expect(result.structured).toBe(undefined);
    resolvedThinkingLevel = "off";
    const reported = await compat.execute!({ ...request, readOnly: false, isolation: { requested: true, apply: true, merge: "patch" } });
    expect(reported.resolvedThinkingLevel).toBe("off");
  });

});

describe("check processes", () => {
  test("null timeout allows a delayed process to finish", async () => {
    const result = await runProcess(["sh", "-c", "sleep 0.05; printf completed"], { cwd: "/tmp", timeoutMs: null });
    expect(result.status).toBe("passed");
    expect(result.stdout).toBe("completed");
    expect(result.exitCode).toBe(0);
  });

  test("an explicit timeout still kills a running process", async () => {
    const result = await runProcess(["sh", "-c", "exec sleep 10"], { cwd: "/tmp", timeoutMs: 10 });
    expect(result.status).toBe("timed_out");
  });
});
