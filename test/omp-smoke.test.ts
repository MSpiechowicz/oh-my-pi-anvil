import { describe, expect, test } from "./test-helpers.ts";
import { createOmpCompat } from "../src/runners/omp-compat.ts";
import { OmpSubprocessRunner } from "../src/runners/omp-subprocess-runner.ts";

const request = {
  runId: "run",
  attemptId: "attempt",
  role: "security" as const,
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

});
