import { displayState } from "../workflow/state.ts";
import type { WorkflowProgressHandler, WorkflowProgressUpdate, WorkflowState } from "../workflow/types.ts";

export interface ForgeProgressUI {
  notify?: (message: string, level?: string) => unknown;
  setStatus?: (key: string, text: string | undefined) => unknown;
  setWidget?: (key: string, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }) => unknown;
  setWorkingMessage?: (message?: string) => unknown;
}

export interface ForgeProgressReporter {
  onProgress: WorkflowProgressHandler;
  begin(): void;
  close(): void;
}

const STATUS_KEY = "anvil-forge";
const WIDGET_KEY = "anvil-forge-progress";
const REFRESH_MS = 800;
const SPINNER_FRAMES = ["|", "/", "-", "\\"];
const STAGES: WorkflowState[] = ["PLAN", "IMPLEMENT", "CHECKS", "SECURITY", "REVIEW"];
const ACTIVITIES: Record<WorkflowState, string> = {
  INIT: "initializing the workspace",
  PLAN: "planning the objective",
  IMPLEMENT: "implementing the planned change",
  CHECKS: "running deterministic checks",
  SECURITY: "auditing the current revision",
  REVIEW: "reviewing acceptance criteria",
  DONE: "workflow sealed",
  BLOCKED: "workflow blocked",
  FAILED: "workflow failed",
  CANCELLED: "workflow cancelled",
};

function ignoreUiFailure(action: () => unknown): void {
  try {
    const result = action();
    if (result && typeof result === "object" && "catch" in result && typeof result.catch === "function") {
      void result.catch(() => undefined);
    }
  } catch {
    // Progress UI is best effort and must not change workflow execution.
  }
}

function stageMarker(state: WorkflowState, current: WorkflowState): string {
  const currentIndex = STAGES.indexOf(current);
  const stageIndex = STAGES.indexOf(state);
  if (current === state) return ">";
  if (currentIndex >= 0 && stageIndex >= 0 && stageIndex < currentIndex) return "x";
  if (current === "DONE") return "x";
  return " ";
}

function statusText(update: WorkflowProgressUpdate, frame: string, activeStage?: WorkflowState): string {
  const failedDuring = update.kind === "finished" && update.run.status !== "done" && activeStage && activeStage !== update.run.currentState;
  const activity = failedDuring
    ? `${ACTIVITIES[update.run.currentState]} (during ${displayState(activeStage)})`
    : ACTIVITIES[update.run.currentState];
  if (update.kind === "finished") {
    return `${update.run.status === "done" ? "x" : "!"} ${displayState(update.run.currentState)} · ${activity}`;
  }
  return `${frame} ${displayState(update.run.currentState)} · ${activity}`;
}

function widgetLines(update: WorkflowProgressUpdate, frame: string, activeStage?: WorkflowState): string[] {
  const stage = update.kind === "finished" && update.run.status !== "done"
    ? activeStage ?? update.run.currentState
    : update.run.currentState;
  return [
    `ANVIL · FORGE RUN ${update.run.id}`,
    statusText(update, frame, activeStage),
    "",
    "STAGES",
    ...STAGES.map((state) => `  [${stageMarker(state, stage)}] ${displayState(state)}`),
  ];
}

export function createForgeProgressReporter(ui: ForgeProgressUI | undefined): ForgeProgressReporter {
  const persistent = Boolean(ui?.setStatus || ui?.setWidget || ui?.setWorkingMessage);
  let closed = false;
  let frameIndex = 0;
  let timer: NodeJS.Timeout | undefined;
  let current: WorkflowProgressUpdate | undefined;
  let activeStage: WorkflowState | undefined;

  const renderStarting = (): void => {
    const frame = SPINNER_FRAMES[frameIndex];
    ignoreUiFailure(() => ui?.setStatus?.(STATUS_KEY, `${frame} Forge · acquiring workspace lock`));
    ignoreUiFailure(() => ui?.setWorkingMessage?.(`${frame} Forge · acquiring workspace lock`));
    ignoreUiFailure(() =>
      ui?.setWidget?.(WIDGET_KEY, ["ANVIL · FORGE", `${frame} Acquiring workspace lock`], { placement: "aboveEditor" })
    );
  };

  const render = (): void => {
    if (closed) return;
    const frame = SPINNER_FRAMES[frameIndex];
    const update = current;
    if (!update) return renderStarting();
    const text = statusText(update, frame, activeStage);
    ignoreUiFailure(() => ui?.setStatus?.(STATUS_KEY, text));
    ignoreUiFailure(() => ui?.setWorkingMessage?.(text));
    ignoreUiFailure(() => ui?.setWidget?.(WIDGET_KEY, widgetLines(update, frame, activeStage), { placement: "aboveEditor" }));
  };

  const schedule = (): void => {
    if (closed || !persistent || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (closed) return;
      frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
      render();
      schedule();
    }, REFRESH_MS);
  };

  return {
    begin(): void {
      if (closed) return;
      renderStarting();
      if (!persistent && ui?.notify) {
        ignoreUiFailure(() => ui.notify!("ANVIL · FORGE STARTING\n\nAcquiring workspace lock and preparing Forge.", "info"));
      }
      schedule();
    },
    onProgress: (update): void => {
      if (closed) return;
      if (update.kind === "stage") activeStage = update.run.currentState;
      current = update;
      render();
      if (!persistent && ui?.notify && (update.kind === "stage" || update.kind === "finished")) {
        ignoreUiFailure(() => ui.notify!(`ANVIL · FORGE\n\n${statusText(update, SPINNER_FRAMES[frameIndex], activeStage)}`, "info"));
      }
      schedule();
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      ignoreUiFailure(() => ui?.setStatus?.(STATUS_KEY, undefined));
      ignoreUiFailure(() => ui?.setWidget?.(WIDGET_KEY, undefined));
      ignoreUiFailure(() => ui?.setWorkingMessage?.());
    },
  };
}
