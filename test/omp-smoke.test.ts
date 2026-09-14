import { describe, expect, test } from "bun:test";
import { OmpSubprocessRunner } from "../src/runners/omp-subprocess-runner.ts";

describe("OMP adapter", () => {
  test("fails clearly when no host executor is available", async () => {
    const runner = new OmpSubprocessRunner({}); const result = await runner.run({ runId: "run", attemptId: "attempt", role: "security", agentName: "missing", assignment: "check", outputSchema: {}, schemaMode: "strict", cwd: "/tmp", baseRevisionId: "wr1:none", readOnly: true }); expect(result.status).toBe("failed"); expect(result.error?.code).toBe("OMP_EXECUTOR_UNAVAILABLE");
  });
});
