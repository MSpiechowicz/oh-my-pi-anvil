import { describe, expect, test } from "./test-helpers.ts";
import { createForgeProgressReporter } from "../src/ui/progress.ts";
import type { WorkflowProgressUpdate } from "../src/workflow/types.ts";

function update(state: WorkflowProgressUpdate["run"]["currentState"], kind: WorkflowProgressUpdate["kind"]): WorkflowProgressUpdate {
  return {
    kind,
    run: { id: "run_live", currentState: state, status: state === "DONE" ? "done" : "running" } as WorkflowProgressUpdate["run"],
  };
}

describe("Forge progress UI", () => {
  test("keeps the current stage visible and clears owned UI on completion", () => {
    const statuses: Array<string | undefined> = [];
    const widgets: Array<string[] | undefined> = [];
    const workingMessages: Array<string | undefined> = [];
    const reporter = createForgeProgressReporter({
      setStatus: (_key, text) => statuses.push(text),
      setWidget: (_key, content) => widgets.push(content),
      setWorkingMessage: (message) => workingMessages.push(message),
    });

    reporter.begin();
    reporter.onProgress(update("PLAN", "started"));
    reporter.onProgress(update("CHECKS", "stage"));
    reporter.onProgress(update("DONE", "finished"));
    reporter.close();

    expect(statuses.some((text) => text?.includes("Architect · planning the objective"))).toBeTruthy();
    expect(statuses.some((text) => text?.includes("Warden · running deterministic checks"))).toBeTruthy();
    expect(widgets.some((content) => content?.includes("  [>] Warden"))).toBeTruthy();
    expect(statuses[statuses.length - 1]).toBe(undefined);
    expect(widgets[widgets.length - 1]).toBe(undefined);
    expect(workingMessages[workingMessages.length - 1]).toBe(undefined);
  });
  test("identifies the stage that failed", () => {
    const statuses: Array<string | undefined> = [];
    const widgets: Array<string[] | undefined> = [];
    const reporter = createForgeProgressReporter({
      setStatus: (_key, text) => statuses.push(text),
      setWidget: (_key, content) => widgets.push(content),
    });

    reporter.onProgress(update("PLAN", "stage"));
    reporter.onProgress({
      kind: "finished",
      run: { id: "run_live", currentState: "FAILED", status: "failed" } as WorkflowProgressUpdate["run"],
    });
    reporter.close();

    expect(statuses.some((text) => text?.includes("workflow failed (during Architect)"))).toBeTruthy();
    expect(widgets.some((content) => content?.includes("  [>] Architect"))).toBeTruthy();
  });
});
