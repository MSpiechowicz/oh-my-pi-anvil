import { describe, expect, test } from "./test-helpers.ts";
import { createForgeProgressReporter } from "../src/ui/progress.ts";
import type { WorkflowProgressUpdate } from "../src/workflow/types.ts";

function update(state: WorkflowProgressUpdate["run"]["currentState"], kind: WorkflowProgressUpdate["kind"], advisory?: WorkflowProgressUpdate["advisory"]): WorkflowProgressUpdate {
  return {
    kind,
    advisory,
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
  test("shows enabled advisory lifecycle in execution order without competing core activity", () => {
    const widgets: Array<string[] | undefined> = [];
    const reporter = createForgeProgressReporter({ setWidget: (_key, content) => widgets.push(content) });
    try {
      reporter.onProgress(update("PLAN", "started", { scout: "pending", archivist: "pending" }));
      reporter.onProgress(update("PLAN", "stage", { scout: "running", archivist: "pending" }));
      reporter.onProgress(update("PLAN", "stage", { scout: "completed", archivist: "pending" }));
      reporter.onProgress(update("REVIEW", "stage", { scout: "completed", archivist: "pending" }));
      reporter.onProgress(update("REVIEW", "stage", { scout: "completed", archivist: "running" }));
      reporter.onProgress(update("REVIEW", "stage", { scout: "completed", archivist: "completed" }));
      reporter.onProgress(update("DONE", "finished", { scout: "completed", archivist: "completed" }));
      const rows = widgets.map((content) => content!.join("\n").split("\n").filter((line) => /^[ \t]*[·✓!–◐◓◑◒] (Scout|Architect|Smith|Warden|Sentinel|Inquisitor|Archivist)\s/u.test(line)));
      const labels = ["Scout", "Architect", "Smith", "Warden", "Sentinel", "Inquisitor", "Archivist"];
      for (const panel of rows) expect(panel.map((line) => line.trim().split(/\s+/)[1])).toEqual(labels);
      const markers = rows.map((panel) => panel.map((line) => line.trim()[0]));
      expect(markers[0]).toEqual(["·", "◐", "·", "·", "·", "·", "·"]);
      expect(markers[1]).toEqual(["◐", "·", "·", "·", "·", "·", "·"]);
      expect(markers[2]).toEqual(["✓", "◐", "·", "·", "·", "·", "·"]);
      expect(markers[3]).toEqual(["✓", "✓", "✓", "✓", "✓", "◐", "·"]);
      expect(markers[4]).toEqual(["✓", "✓", "✓", "✓", "✓", "✓", "◐"]);
      expect(markers[5]).toEqual(["✓", "✓", "✓", "✓", "✓", "✓", "✓"]);
      expect(markers[6]).toEqual(["✓", "✓", "✓", "✓", "✓", "✓", "✓"]);
    } finally {
      reporter.close();
    }
  });
  test("preserves advisory failures while core work continues and seals", () => {
    const widgets: Array<string[] | undefined> = [];
    const reporter = createForgeProgressReporter({ setWidget: (_key, content) => widgets.push(content) });
    try {
      reporter.onProgress(update("PLAN", "stage", { scout: "failed", archivist: "pending" }));
      const planning = widgets.at(-1)!.join("\n");
      expect(planning).toContain("! Scout");
      expect(planning).toContain("◐ Architect");
      reporter.onProgress(update("REVIEW", "stage", { scout: "failed", archivist: "failed" }));
      const curated = widgets.at(-1)!.join("\n");
      expect(curated).toContain("✓ Inquisitor");
      expect(curated).toContain("! Archivist");
      expect(/[◐◓◑◒]/u.test(curated)).toBe(false);
      reporter.onProgress(update("DONE", "finished", { scout: "failed", archivist: "failed" }));
      const sealed = widgets.at(-1)!.join("\n");
      expect(sealed).toContain("✓ Sealed");
      expect(sealed).toContain("! Scout");
      expect(sealed).toContain("! Archivist");
      expect(sealed.includes("✓ Scout")).toBe(false);
      expect(sealed.includes("✓ Archivist")).toBe(false);
    } finally {
      reporter.close();
    }
  });
  test("does not turn skipped or terminal pending advisory roles into positional successes", () => {
    const widgets: Array<string[] | undefined> = [];
    const reporter = createForgeProgressReporter({ setWidget: (_key, content) => widgets.push(content) });
    try {
      reporter.onProgress(update("CHECKS", "stage", { scout: "skipped", archivist: "pending" }));
      expect(widgets.at(-1)!.join("\n")).toContain("– Scout");
      reporter.onProgress({
        kind: "finished",
        run: { id: "run_live", currentState: "FAILED", status: "failed" } as WorkflowProgressUpdate["run"],
        advisory: { scout: "skipped", archivist: "skipped" },
      });
      const failed = widgets.at(-1)!.join("\n");
      expect(failed).toContain("! Warden");
      expect(failed).toContain("– Scout");
      expect(failed).toContain("– Archivist");
      reporter.onProgress(update("DONE", "finished", { scout: "pending", archivist: "pending" }));
      const pending = widgets.at(-1)!.join("\n");
      expect(pending).toContain("· Scout");
      expect(pending).toContain("· Archivist");
      expect(pending.includes("✓ Scout")).toBe(false);
      expect(pending.includes("✓ Archivist")).toBe(false);
    } finally {
      reporter.close();
    }
  });
  test("keeps disabled advisory roles hidden independently and accepts legacy updates", () => {
    const widgets: Array<string[] | undefined> = [];
    const reporter = createForgeProgressReporter({ setWidget: (_key, content) => widgets.push(content) });
    try {
      const legacy = update("PLAN", "started");
      delete legacy.advisory;
      reporter.onProgress(legacy);
      reporter.onProgress(update("PLAN", "stage", {}));
      for (const content of widgets) {
        expect(content!.join("\n").includes("Scout")).toBe(false);
        expect(content!.join("\n").includes("Archivist")).toBe(false);
        expect(content!.join("\n")).toContain("◐ Architect");
      }
      reporter.onProgress(update("PLAN", "stage", { scout: "running" }));
      expect(widgets.at(-1)!.join("\n")).toContain("◐ Scout");
      expect(widgets.at(-1)!.join("\n").includes("Archivist")).toBe(false);
      reporter.onProgress(update("REVIEW", "stage", { archivist: "running" }));
      expect(widgets.at(-1)!.join("\n")).toContain("◐ Archivist");
      expect(widgets.at(-1)!.join("\n").includes("Scout")).toBe(false);
    } finally {
      reporter.close();
    }
  });
  test("attributes interruption to the active advisory role instead of its enclosing core stage", () => {
    for (const role of ["scout", "archivist"] as const) {
      const widgets: Array<string[] | undefined> = [];
      const reporter = createForgeProgressReporter({ setWidget: (_key, content) => widgets.push(content) });
      try {
        reporter.onProgress(update(role === "scout" ? "PLAN" : "REVIEW", "stage", { [role]: "running" }));
        reporter.onProgress({
          kind: "finished",
          run: { id: "run_live", currentState: "CANCELLED", status: "cancelled" } as WorkflowProgressUpdate["run"],
          advisory: { [role]: "failed" },
        });
        const cancelled = widgets.at(-1)!.join("\n");
        const label = role === "scout" ? "Scout" : "Archivist";
        expect(cancelled).toContain(`! ${label}`);
        expect(cancelled).toContain(`during ${label}`);
        expect(cancelled).toContain(role === "scout" ? "· Architect" : "✓ Inquisitor");
        expect(cancelled.includes(role === "scout" ? "! Architect" : "! Inquisitor")).toBe(false);
        expect(/[◐◓◑◒]/u.test(cancelled)).toBe(false);
      } finally {
        reporter.close();
      }
    }
  });
  test("identifies running advisory roles on both fallback surfaces", () => {
    for (const useStatus of [true, false]) {
      const statuses: Array<string | undefined> = [];
      const messages: Array<string | undefined> = [];
      const reporter = createForgeProgressReporter({
        ...(useStatus ? { setStatus: (_key: string, text: string | undefined) => statuses.push(text) } : {}),
        setWorkingMessage: (text) => messages.push(text),
      });
      try {
        reporter.onProgress(update("PLAN", "stage", { scout: "running", archivist: "pending" }));
        reporter.onProgress(update("PLAN", "stage", { scout: "completed", archivist: "pending" }));
        reporter.onProgress(update("REVIEW", "stage", { scout: "completed", archivist: "running" }));
        const active = useStatus ? statuses : messages;
        expect(active[0]).toContain("Scout");
        expect(active[0]!.includes("Architect")).toBe(false);
        expect(active[0]!.includes("planning")).toBe(false);
        expect(active[1]).toContain("Architect");
        expect(active[2]).toContain("Archivist");
        expect(active[2]!.includes("Inquisitor")).toBe(false);
        expect(active[2]!.includes("reviewing")).toBe(false);
        if (useStatus) expect(messages.length).toBe(0);
      } finally {
        reporter.close();
      }
      expect((useStatus ? statuses : messages).at(-1)).toBe(undefined);
    }
  });
});
