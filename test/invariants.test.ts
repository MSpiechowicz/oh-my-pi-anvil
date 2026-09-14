import { describe, expect, test } from "./test-helpers.ts";
import { assertLegalTransition } from "../src/workflow/transitions.ts";
import { AnvilError } from "../src/util/errors.ts";
import { serializeHandoff } from "../src/context/serializers.ts";

describe("workflow invariants", () => {
  test("rejects direct implementation to done", () => { expect(() => assertLegalTransition("IMPLEMENT", "DONE")).toThrow(); });
  test("does not let historical fields grow a handoff", () => {
    const base = { version: 1 as const, runId: "run", role: "implementation" as const, mutationEpoch: 3, revisionId: "wr1:current", objective: { id: "obj", path: "objective.md", sha256: "hash" }, constraints: { maxInlineChars: 1200, readOnly: false, noTranscript: true as const } };
    const short = serializeHandoff(base, 1200); const withHistory = serializeHandoff({ ...base, memory: [{ content: "A durable convention" }], openFindings: [{ id: "SEC-1", source: "security", severity: "high", title: "Fix authorization", artifact: base.objective }], changedFiles: ["src/a.ts", "src/b.ts"] }, 1200); expect(withHistory.length).toBeLessThanOrEqual(1200); expect(short.length).toBeLessThanOrEqual(1200);
  });
  test("exposes typed invariant errors", () => { const error = new AnvilError("INVARIANT_VIOLATION", "stale gate"); expect(error.code).toBe("INVARIANT_VIOLATION"); });
});
