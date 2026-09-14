import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { StateDatabase } from "../src/state/database.ts";
import { FindingRepository, RunRepository } from "../src/state/repositories.ts";


describe("finding lifecycle", () => {
  test("deduplicates, resolves, and reopens a finding without line-number churn", async () => {
    const root = await mkdtemp("/tmp/anvil-findings-"); const state = await StateDatabase.open(path.join(root, ".omp")); const repository = new FindingRepository(state); const runs = new RunRepository(state); const run = runs.create({ id: "run", workflowName: "test", workflowVersion: 1, configHash: "config", workspaceRoot: root, objectivePath: "objective.md", baseRevisionId: "wr1:0", currentRevisionId: "wr1:0", mutationEpoch: 0, initialHead: "head" }); const first = runs.beginAttempt(run, "SECURITY", "security", "security");
    const input = { runId: "run", sourceGate: "security" as const, fingerprint: "fingerprint", severity: "high", category: "authorization", title: "Missing authorization", description: "Authorization is missing", fixRequirement: "Add authorization", firstSeenEpoch: 1, lastSeenEpoch: 1, firstAttemptId: first.id, lastAttemptId: first.id };
    const created = repository.upsert(input); expect(created.id).toBe("SEC-0001"); repository.resolveGate("run", "security", first.id); const second = runs.beginAttempt(runs.require("run"), "SECURITY", "security", "security"); const reopened = repository.upsert({ ...input, lastSeenEpoch: 2, firstAttemptId: first.id, lastAttemptId: second.id }); expect(reopened.id).toBe(created.id); expect(reopened.timesSeen).toBe(2); expect(reopened.reopenCount).toBe(1); expect(repository.list("run", "open")).toHaveLength(1); state.close(); await rm(root, { recursive: true, force: true });
  });
});
