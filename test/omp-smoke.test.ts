import { describe, expect, test } from "./test-helpers.ts";
import { createOmpCompat } from "../src/runners/omp-compat.ts";
import { OmpSubprocessRunner } from "../src/runners/omp-subprocess-runner.ts";

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
