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
    for (const { role, agentName, isolated } of [
      { role: "planner", agentName: "architect", isolated: false },
      { role: "planner", agentName: "architect", isolated: true },
      { role: "implementation", agentName: "smith", isolated: false },
      { role: "implementation", agentName: "smith", isolated: true },
      { role: "security", agentName: "sentinel", isolated: false },
      { role: "review", agentName: "inquisitor", isolated: false },
      { role: "scout", agentName: "scout", isolated: false },
      { role: "archivist", agentName: "archivist", isolated: false },
    ] as const) {
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
        const progress = (provider: string, model: string, resolvedThinkingLevel: string) => bus.emit("task:subagent:progress", {
          progress: { id: "native-child", resolvedModelIdentity: `${provider}/${model}`, resolvedThinkingLevel },
        });
        progress("first", "original", "auto");
        for (const [provider, model, stopReason] of [["first", "original", "error"], ["second", "fallback", "stop"]] as const) {
          const message = { role: "assistant", provider, model, stopReason, usage };
          bus.emit("task:subagent:event", { id: "native-child", event: { type: "message_update", message } });
          bus.emit("task:subagent:event", { id: "native-child", event: { type: "message_end", message } });
          // Native executor publishes the serving model after the raw event.
          progress(provider, model, provider === "first" ? "xhigh" : "high");
          bus.emit("task:subagent:event", { id: "native-child", event: { type: "agent_end", messages: [message] } });
        }
        bus.emit("task:subagent:event", { event: { type: "message_end", message: { role: "toolResult", usage } } });
        return { exitCode: 1, aborted: true, usage: { ...usage, totalTokens: 34 } };
      };
      const compat = createOmpCompat({ sessionManager: manager, model: { provider: "parent", id: "model:low" } }, {
        Settings: { loadReadOnly: () => ({ get: () => ({}), override: () => {} }) },
        discoverAgents: () => ({ agents: [{ name: agentName, tools: ["read"] }] }),
        runSubprocess: (options: { eventBus: Bus }) => { bus = options.eventBus; return finish(); },
        TaskTool: { create: (session: { eventBus: Bus }) => {
          bus = session.eventBus;
          return { execute: () => ({ details: { results: [finish()] } }) };
        } },
      });
      const result = await compat.execute!({ ...request, role, agentName, thinkingLevel: "low", ...(isolated ? { isolation: { requested: true, apply: true, merge: "patch" as const } } : {}) });
      expect(result.status).toBe("aborted");
      expect(entries).toEqual([
        { purpose: "forge", role, provider: "first", model: "original", usage, thinkingLevel: "xhigh" },
        { purpose: "forge", role, provider: "second", model: "fallback", usage, thinkingLevel: "high" },
      ]);
      sessionId = "another-session";
      bus!.emit("task:subagent:event", { event: {
        type: "message_end", message: { role: "assistant", provider: "late", model: "response", usage },
      } });
      await Promise.resolve();
      expect(entries.length).toBe(2);
    }
  });

  test("concurrent Smiths retain interleaved usage across models and sibling cancellation", async () => {
    const entries: Array<{ role: string; model: string; thinkingLevel: string | null; usage: { totalTokens: number } }> = [];
    const joined = Promise.withResolvers<void>();
    const firstFinished = Promise.withResolvers<void>();
    let started = 0;
    const compat = createOmpCompat({
      sessionManager: {
        getSessionId: () => "smith-batch",
        getLeafId: () => "origin",
        appendModelUsage(entry: typeof entries[number]) { entries.push(entry); },
      },
    }, {
      Settings: { loadReadOnly: () => ({ get: () => ({}), override: () => {} }) },
      discoverAgents: () => ({ agents: [{ name: "smith", tools: ["read", "edit"] }] }),
      async runSubprocess(options: { id: string; eventBus: { emit: (name: string, payload: unknown) => void } }) {
        const emit = (model: string, totalTokens: number, resolvedThinkingLevel: string | undefined) => {
          options.eventBus.emit("task:subagent:event", { id: options.id, event: {
            type: "message_end",
            message: { role: "assistant", provider: "provider", model,
              usage: { input: totalTokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
          } });
          options.eventBus.emit("task:subagent:progress", {
            progress: { id: options.id, resolvedModelIdentity: `provider/${model}`, resolvedThinkingLevel },
          });
        };
        emit("shared-model", options.id === "smith-a" ? 10 : 20, options.id === "smith-a" ? "high" : "xhigh");
        if (++started === 2) joined.resolve();
        await joined.promise;
        if (options.id === "smith-a") {
          emit("fallback-model", 30, "medium");
          firstFinished.resolve();
          return { exitCode: 0, structuredOutput: { status: "valid", data: { completed: true } },
            usage: { totalTokens: 40 } };
        }
        await firstFinished.promise;
        emit("shared-model", 40, undefined);
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
    expect(entries.map(({ role, thinkingLevel, usage }) => [role, usage.totalTokens, thinkingLevel])).toEqual([
      ["implementation", 10, "high"],
      ["implementation", 20, "xhigh"],
      ["implementation", 30, "medium"],
      ["implementation", 40, null],
    ]);
  });

  test("streams request thinking without leaking metadata across IDs, models, or unknown progress", async () => {
    const entries: Array<Record<string, unknown>> = [];
    let liveThinking: unknown[] = [];
    const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const compat = createOmpCompat({
      model: { provider: "parent", id: "model:low" },
      sessionManager: {
        getSessionId: () => "origin",
        getLeafId: () => "branch",
        appendModelUsage(entry: Record<string, unknown>) { entries.push(entry); },
      },
    }, {
      Settings: { loadReadOnly: () => ({ get: () => "low", override: () => {} }) },
      discoverAgents: () => ({ agents: [{ name: "architect", tools: ["read"] }] }),
      async runSubprocess({ eventBus }: { eventBus: { emit: (name: string, payload: unknown) => void } }) {
        const progress = (id: string, resolvedModelIdentity: string | undefined, resolvedThinkingLevel: unknown) => {
          eventBus.emit("task:subagent:progress", { progress: { id, resolvedModelIdentity, resolvedThinkingLevel } });
        };
        const end = (id: string | undefined, model = "original", provider = "serving") => {
          eventBus.emit("task:subagent:event", { id, event: {
            type: "message_end", message: { role: "assistant", provider, model, usage, stopReason: "error" },
          } });
        };
        progress("a", "serving/original", "auto");
        end("a");
        progress("a", "serving/original", "xhigh");
        end("a");
        progress("a", "serving/original", "high");
        await Promise.resolve();
        // Two same-tick requests retain their own levels and are already live.
        liveThinking = entries.map((entry) => entry.thinkingLevel);
        end("b");
        progress("a", "serving/original", "max");
        end("a", "fallback");
        progress("a", "serving/fallback", "off");
        end("a", "original");
        progress("a", "serving/fallback", "high");
        end("a", "fallback", "other-provider");
        end("a", "fallback");
        progress("a", "serving/fallback", undefined);
        end("a", "fallback");
        progress("a", "serving/fallback", "auto");
        end("a", "fallback");
        progress("a", "serving/fallback", "invalid");
        end("a", "fallback");
        progress("a", undefined, "xhigh");
        end(undefined);
        progress("a", "serving/original", "xhigh");
        eventBus.emit("task:subagent:lifecycle", { id: "a", status: "completed" });
        eventBus.emit("task:subagent:lifecycle", { id: "a", status: "started" });
        end("a");
        await Promise.resolve();
        // Stable serving metadata still works when the host coalesces progress.
        progress("a", "serving/original", "minimal");
        end("a");
        await Promise.resolve();
        end("a", "unreported-fallback");
        end("a");
        await Promise.resolve();
        throw new Error("cancelled after emitted usage");
      },
    });
    const result = await compat.execute!({ ...request, model: "configured/model:xhigh", thinkingLevel: "low" });
    expect(result.status).toBe("failed");
    expect(liveThinking).toEqual(["xhigh", "high"]);
    expect(entries.map((entry) => entry.thinkingLevel)).toEqual([
      "xhigh", "high", null, "off", null, null, null, null, null, null, null, null, "minimal", null, null,
    ]);
    expect(entries[12]).toEqual({ purpose: "forge", role: "planner", provider: "serving", model: "original", usage, thinkingLevel: "minimal" });
  });

  test("reports deferred usage writer failures through both native executor boundaries", async () => {
    for (const isolated of [false, true]) {
      for (const asynchronous of [false, true]) {
        const failure = new Error("usage storage unavailable");
        const compat = createOmpCompat({
          sessionManager: {
            getSessionId: () => "origin",
            getLeafId: () => "branch",
            appendModelUsage() {
              if (asynchronous) {
                const { promise, reject } = Promise.withResolvers<never>();
                queueMicrotask(() => reject(failure));
                return promise;
              }
              throw failure;
            },
          },
        }, {
          Settings: { loadReadOnly: () => ({ get: () => ({}), override: () => {} }) },
          discoverAgents: () => ({ agents: [{ name: "architect", tools: ["read"] }] }),
          runSubprocess: finish,
          TaskTool: { create: (session: { eventBus: { emit: (name: string, payload: unknown) => void } }) => ({
            execute: async () => ({ details: { results: [await finish(session)] } }),
          }) },
        });
        async function finish({ eventBus }: { eventBus: { emit: (name: string, payload: unknown) => void } }) {
          eventBus.emit("task:subagent:event", { id: "child", event: {
            type: "message_end", message: {
              role: "assistant", provider: "provider", model: "model", usage: { totalTokens: 1 },
            },
          } });
          // Let the scheduled write run, rather than flushing via a later event.
          await Promise.resolve();
          return { exitCode: 0, structuredOutput: { status: "valid", data: { completed: true } } };
        }
        const result = await compat.execute!({
          ...request, ...(isolated ? { isolation: { requested: true, apply: true, merge: "patch" as const } } : {}),
        });
        expect(result.status).toBe("failed");
        expect(result.error).toEqual({ code: "OMP_TASK_EXECUTION_FAILED", message: failure.message });
      }
    }
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
