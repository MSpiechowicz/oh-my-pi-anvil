import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "./test-helpers.ts";
import { StateDatabase } from "../src/state/database.ts";
import { FindingRepository, RunRepository } from "../src/state/repositories.ts";


describe("finding lifecycle", () => {
  test("deduplicates, resolves, and reopens a finding without line-number churn", async () => {
    const root = await mkdtemp("/tmp/anvil-findings-"); const state = await StateDatabase.open(path.join(root, ".omp")); const repository = new FindingRepository(state); const runs = new RunRepository(state); const run = runs.create({ id: "run", workflowName: "test", workflowVersion: 1, configHash: "config", workspaceRoot: root, objectivePath: "objective.md", baseRevisionId: "wr1:0", currentRevisionId: "wr1:0", mutationEpoch: 0, initialHead: "head" }); const first = runs.beginAttempt(run, "SECURITY", "security", "security");
    const input = { runId: "run", sourceGate: "security" as const, fingerprint: "fingerprint", severity: "high", category: "authorization", title: "Missing authorization", description: "Authorization is missing", fixRequirement: "Add authorization", firstSeenEpoch: 1, lastSeenEpoch: 1, firstAttemptId: first.id, lastAttemptId: first.id };
    const created = repository.upsert(input); repository.resolveGate("run", "security", first.id); const second = runs.beginAttempt(runs.require("run"), "SECURITY", "security", "security"); const reopened = repository.upsert({ ...input, lastSeenEpoch: 2, firstAttemptId: first.id, lastAttemptId: second.id }); expect(reopened.id).toBe(created.id); expect(reopened.timesSeen).toBe(2); expect(reopened.reopenCount).toBe(1); expect(repository.list("run", "open")).toHaveLength(1); state.close(); await rm(root, { recursive: true, force: true });
  });
  test("isolates identical findings across runs in the same database", async () => {
    const root = await mkdtemp("/tmp/anvil-findings-");
    const state = await StateDatabase.open(path.join(root, ".omp"));
    try {
      const repository = new FindingRepository(state);
      const runs = new RunRepository(state);
      const inputs = ["first", "second"].map((id) => {
        const run = runs.create({ id, workflowName: "test", workflowVersion: 1, configHash: "config", workspaceRoot: root, objectivePath: "objective.md", baseRevisionId: "wr1:0", currentRevisionId: "wr1:0", mutationEpoch: 0, initialHead: "head" });
        const attempt = runs.beginAttempt(run, "SECURITY", "security", "security");
        return { runId: id, sourceGate: "security" as const, fingerprint: "same", severity: "high", category: "authorization", title: "Missing authorization", description: "Authorization is missing", firstSeenEpoch: 1, lastSeenEpoch: 1, firstAttemptId: attempt.id, lastAttemptId: attempt.id };
      });
      const first = repository.upsert(inputs[0]);
      const second = repository.upsert(inputs[1]);
      expect(first.id === second.id).toBe(false);
      repository.resolveGate("first", "security", inputs[0].lastAttemptId);
      expect(repository.list("first", "open")).toHaveLength(0);
      expect(repository.list("second", "open").map((finding) => finding.id)).toEqual([second.id]);
      const reopened = repository.upsert(inputs[0]);
      expect(reopened.id).toBe(first.id);
      expect(reopened.reopenCount).toBe(1);
      expect(repository.list("second")[0].timesSeen).toBe(1);
    } finally {
      state.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
