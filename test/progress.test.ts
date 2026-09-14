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
    const planning = widgets.at(-1)!.join("\n").split("\n");
    reporter.onProgress(update("CHECKS", "stage"));
    const checking = widgets.at(-1)!.join("\n").split("\n");
    reporter.onProgress(update("DONE", "finished"));
    reporter.close();

    const labels = ["Architect", "Smith", "Warden", "Sentinel", "Inquisitor"];
    const planningRows = planning.filter((line) => labels.some((label) => line.includes(label)));
    const checkingRows = checking.filter((line) => labels.some((label) => line.includes(label)));
    expect(planningRows.map((line) => line.trim().split(/\s+/)[1])).toEqual(labels);
    expect(planningRows.map((line) => line.trim()[0])).toEqual(["◐", "·", "·", "·", "·"]);
    expect(checkingRows.map((line) => line.trim()[0])).toEqual(["✓", "✓", "◐", "·", "·"]);
    expect(planningRows.every((line) => line.slice(16).trim().length > 0)).toBeTruthy();
    expect(statuses.length).toBe(0);
    expect(workingMessages.length).toBe(0);
    expect(widgets.filter((content) => content !== undefined).every((content) => content.at(-1)?.endsWith("\n"))).toBeTruthy();
    expect(widgets[widgets.length - 1]).toBe(undefined);
    const count = widgets.length;
    reporter.onProgress(update("IMPLEMENT", "stage"));
    reporter.close();
    expect(widgets.length).toBe(count);
  });
  test("identifies the stage that failed", () => {
    const statuses: Array<string | undefined> = [];
    const widgets: Array<string[] | undefined> = [];
    const reporter = createForgeProgressReporter({
      setStatus: (_key, text) => statuses.push(text),
      setWidget: (_key, content) => widgets.push(content),
    });

    reporter.onProgress(update("PLAN", "started"));
    reporter.onProgress({
      kind: "finished",
      run: { id: "run_live", currentState: "FAILED", status: "failed" } as WorkflowProgressUpdate["run"],
    });
    reporter.close();

    const finalPanel = widgets.filter((content) => content !== undefined).at(-1)!.join("\n");
    expect(finalPanel).toContain("during Architect");
    expect(finalPanel).toContain("! Architect");
    expect(/[◐◓◑◒]/u.test(finalPanel)).toBe(false);
    expect(statuses.length).toBe(0);
  });
  test("uses only one fallback surface when widgets are unavailable", () => {
    for (const useStatus of [true, false]) {
      const statuses: Array<string | undefined> = [];
      const messages: Array<string | undefined> = [];
      const reporter = createForgeProgressReporter({
        ...(useStatus ? { setStatus: (_key: string, text: string | undefined) => statuses.push(text) } : {}),
        setWorkingMessage: (text) => messages.push(text),
      });
      reporter.onProgress(update("CHECKS", "stage"));
      reporter.close();
      const active = useStatus ? statuses : messages;
      expect(active[0]).toContain("Warden");
      expect(active.at(-1)).toBe(undefined);
      if (useStatus) expect(messages.length).toBe(0);
    }
  });
});
