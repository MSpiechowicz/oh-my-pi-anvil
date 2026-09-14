import { displayState } from "../workflow/state.ts";
import type { WorkflowProgressHandler, WorkflowProgressUpdate, WorkflowState } from "../workflow/types.ts";

export interface ForgeProgressUI {
  theme?: {
    fg(color: "accent" | "muted" | "dim" | "success" | "error", text: string): string;
    bold(text: string): string;
  };
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
const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
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
  if (current === state) return "›";
  if (currentIndex >= 0 && stageIndex >= 0 && stageIndex < currentIndex) return "✓";
  if (current === "DONE") return "✓";
  return "·";
}

function statusText(update: WorkflowProgressUpdate, frame: string, activeStage?: WorkflowState): string {
  const failedDuring = update.kind === "finished" && update.run.status !== "done" && activeStage && activeStage !== update.run.currentState;
  const activity = failedDuring
    ? `${ACTIVITIES[update.run.currentState]} (during ${displayState(activeStage)})`
    : ACTIVITIES[update.run.currentState];
  if (update.kind === "finished") {
    return `${update.run.status === "done" ? "✓" : "!"} ${displayState(update.run.currentState)} · ${activity}`;
  }
  return `${frame} ${displayState(update.run.currentState)} · ${activity}`;
}

function widgetLines(update: WorkflowProgressUpdate, frame: string, activeStage?: WorkflowState, theme?: ForgeProgressUI["theme"]): string[] {
  const interrupted = update.kind === "finished" && update.run.status !== "done";
  const stage = interrupted ? activeStage ?? update.run.currentState : update.run.currentState;
  const paint = (color: Parameters<NonNullable<ForgeProgressUI["theme"]>["fg"]>[0], text: string): string =>
    theme ? theme.fg(color, text) : text;
  const stages = STAGES.map((state) => {
    const marker = interrupted && state === stage ? "!" : stageMarker(state, stage);
    const text = `${marker} ${displayState(state)}`;
    return paint(marker === "!" ? "error" : marker === "›" ? "accent" : marker === "✓" ? "success" : "dim", text);
  });
  const title = theme ? theme.bold("FORGE") : "FORGE";
  const runId = update.run.id.replace(/^run_/, "").slice(0, 8);
  return [
    `  ${paint("accent", title)} ${paint("dim", `· ${runId}`)}`,
    `  ${paint(interrupted ? "error" : update.kind === "finished" ? "success" : "accent", statusText(update, frame, activeStage))}`,
    "",
    `  ${stages.slice(0, 3).join(paint("dim", "  →  "))}`,
    `  ${stages.slice(3).join(paint("dim", "  →  "))}`,
    "",
  ];
}

export function createForgeProgressReporter(ui: ForgeProgressUI | undefined): ForgeProgressReporter {
  const persistent = Boolean(ui?.setStatus || ui?.setWidget || ui?.setWorkingMessage);
  let closed = false;
  let frameIndex = 0;
  let timer: NodeJS.Timeout | undefined;
  let current: WorkflowProgressUpdate | undefined;
  let activeStage: WorkflowState | undefined;

  // Prefer one surface; footer and working-message APIs are fallbacks, not mirrors.
  const present = (text: string, lines: string[]): void => {
    if (ui?.setWidget) {
      // OMP drops empty Text children; one multiline child preserves the panel's spacing.
      ignoreUiFailure(() => ui.setWidget!(WIDGET_KEY, [lines.join("\n")], { placement: "aboveEditor" }));
    } else if (ui?.setStatus) {
      ignoreUiFailure(() => ui.setStatus!(STATUS_KEY, text));
    } else {
      ignoreUiFailure(() => ui?.setWorkingMessage?.(text));
    }
  };

  const renderStarting = (): void => {
    const text = `${SPINNER_FRAMES[frameIndex]} Acquiring workspace lock`;
    const title = ui?.theme ? ui.theme.fg("accent", ui.theme.bold("FORGE")) : "FORGE";
    present(text, [`  ${title}`, `  ${text}`, ""]);
  };

  const render = (): void => {
    if (closed) return;
    const frame = SPINNER_FRAMES[frameIndex];
    const update = current;
    if (!update) return renderStarting();
    present(statusText(update, frame, activeStage), widgetLines(update, frame, activeStage, ui?.theme));
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
      if (STAGES.includes(update.run.currentState)) activeStage = update.run.currentState;
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
      if (ui?.setWidget) ignoreUiFailure(() => ui.setWidget!(WIDGET_KEY, undefined));
      else if (ui?.setStatus) ignoreUiFailure(() => ui.setStatus!(STATUS_KEY, undefined));
      else ignoreUiFailure(() => ui?.setWorkingMessage?.());
    },
  };
}
