import { access } from "node:fs/promises";
import path from "node:path";
import { initConfig } from "../config/init.ts";
import { loadConfig } from "../config/load.ts";
import {
  findRepositoryRoot,
  globalConfigPath,
  globalModelsConfigPath,
  nearestProjectConfigPath,
  projectConfigPath,
  runtimeRoot,
} from "../state/paths.ts";
import { isTerminal } from "../workflow/state.ts";
import {
  renderAnvilHelp,
  renderConfiguration,
  renderDoctor,
  renderFindings,
  renderForgeHelp,
  renderInit,
  renderStatus,
  renderUpdate,
  type ConfigurationLocations,
} from "../ui/render.ts";
import { AnvilError } from "../util/errors.ts";
import { runUpdate, UpdateError, type UpdateAction } from "../update.ts";
import type { WorkflowEngine } from "../workflow/engine.ts";
import type { WorkflowProgressHandler, WorkflowProgressUpdate } from "../workflow/types.ts";
import type { WorkspaceLock } from "../state/lock.ts";
import type { IntakeResult, IntakeUI } from "../intake/clarify.ts";

export interface CommandContext { cwd: string; runtimeContext?: unknown; host?: unknown; respond?: (message: string) => void | Promise<void>; progress?: WorkflowProgressHandler; summaryColor?: boolean; intakeUI?: IntakeUI; }
function isRunActive(runtime: RuntimeHandle, lockRunId: string): boolean {
  try {
    if (lockRunId.startsWith("pending_")) return true;
    const state = runtime.engine.status(lockRunId).run.currentState;
    return state !== "BLOCKED" && !isTerminal(state);
  } catch {
    return true;
  }
}
interface RuntimeHandle {
  engine: WorkflowEngine;
  clarify(input: { objective: string; mode?: "auto" | "always" | "off"; ui?: IntakeUI }): Promise<IntakeResult>;
  state: { close(): void };
  lock: WorkspaceLock;
  runtimeRoot?: string;
}

async function configurationLocations(cwd: string): Promise<ConfigurationLocations> {
  const projectRoot = await findRepositoryRoot(cwd);
  const existingProject = await nearestProjectConfigPath(cwd);
  const projectConfig = existingProject ?? (projectRoot ? projectConfigPath(projectRoot) : projectConfigPath(cwd));
  const globalConfig = globalConfigPath();
  let globalConfigPresent = false;
  let effectiveRuntimeRoot = path.resolve(cwd, ".anvil");
  let configError: string | undefined;
  try {
    await access(globalConfig);
    globalConfigPresent = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      configError = error instanceof Error ? error.message : String(error);
    }
  }
  try {
    const config = await loadConfig(cwd);
    effectiveRuntimeRoot = runtimeRoot(cwd, config.persistence.root);
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }
  return {
    globalConfig,
    globalConfigPresent,
    globalModels: globalModelsConfigPath(),
    projectConfig,
    projectConfigPresent: Boolean(existingProject),
    runtimeRoot: effectiveRuntimeRoot,
    configError,
  };
}


export class CommandRouter {
  constructor(private readonly engineFactory: (context: CommandContext) => Promise<RuntimeHandle>) {}

  async handle(raw: string, context: CommandContext): Promise<string> {
    let objective = raw.trim();
    if (!objective || objective === "help") return renderForgeHelp();
    let mode: "auto" | "always" | "off" | undefined;
    if (objective.startsWith("--clarify")) {
      const match = /^--clarify(?:=|\s+)(auto|always|off)(?:\s+|$)/.exec(objective);
      if (!match) return "ANVIL · CONFIG_INVALID\n\nUsage: /forge [--clarify=auto|always|off] <objective>";
      mode = match[1] as typeof mode;
      objective = objective.slice(match[0].length).trim();
    } else if (objective.startsWith("-- ")) {
      objective = objective.slice(3).trim();
    }
    if (!objective) return renderForgeHelp();
    let runtime: RuntimeHandle | undefined;
    let lockHeld = false;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    try {
      runtime = await this.engineFactory(context);
      await runtime.lock.acquire(`pending_${crypto.randomUUID()}`, undefined, (lockRunId) => isRunActive(runtime!, lockRunId));
      lockHeld = true;
      heartbeatTimer = setInterval(() => { void runtime?.lock.heartbeat().catch(() => undefined); }, 10_000);
      const intake = await runtime.clarify({ objective, mode, ui: context.intakeUI });
      if (intake.status !== "ready") return intake.message;
      const progress: WorkflowProgressHandler = async (update: WorkflowProgressUpdate): Promise<void> => {
        if (update.kind === "started") {
          try { await runtime?.lock.bindRun(update.run.id); } catch { /* Lock metadata is best effort. */ }
        }
        await context.progress?.(update);
      };
      return renderStatus(await runtime.engine.start({
        objective: intake.record?.objective ?? objective,
        intake: intake.record,
        workspaceRoot: context.cwd,
        progress,
      }), context.summaryColor);
    } catch (error) {
      const typed = error instanceof AnvilError ? error : new AnvilError("PERSISTENCE_ERROR", error instanceof Error ? error.message : String(error));
      return `ANVIL · ${typed.code}\n\n${typed.message}`;
    } finally {
      clearInterval(heartbeatTimer);
      if (runtime) {
        if (lockHeld) await runtime.lock.release();
        runtime.state.close();
      }
    }
  }

  async handleAdmin(raw: string, context: CommandContext): Promise<string> {
    const [command, ...rest] = raw.trim().split(/\s+/).filter(Boolean);
    if (!command || command === "help") return renderAnvilHelp();
    let runtime: RuntimeHandle | undefined;
    let lockHeld = false;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    try {
      if (command === "config") {
        if (rest.length > 0 && !(rest.length === 1 && rest[0] === "show")) throw new AnvilError("CONFIG_INVALID", "Usage: /anvil config");
        return renderConfiguration(await configurationLocations(context.cwd));
      }
      if (command === "init") {
        if (rest.length > 0) throw new AnvilError("CONFIG_INVALID", "Usage: /anvil init");
        return renderInit(await initConfig(context.cwd));
      }
      if (command === "update") {
        if (rest.length !== 1 || (rest[0] !== "check" && rest[0] !== "install")) throw new AnvilError("CONFIG_INVALID", "Usage: /anvil update check|install");
        return renderUpdate(await runUpdate(rest[0] as UpdateAction, process.env.OMP_PROFILE ?? process.env.PI_PROFILE, context.cwd));
      }
      if (command === "doctor") {
        if (rest.length > 0) throw new AnvilError("CONFIG_INVALID", "Usage: /anvil doctor");
        const locations = await configurationLocations(context.cwd);
        runtime = await this.engineFactory(context);
        return renderDoctor({ ...locations, runtimeRoot: runtime.runtimeRoot ?? locations.runtimeRoot });
      }
      if (command === "status" || command === "findings") {
        if (rest.length > 1) throw new AnvilError("CONFIG_INVALID", `Usage: /anvil ${command} [run-id]`);
        runtime = await this.engineFactory(context);
        const summary = runtime.engine.status(rest[0]);
        return command === "status" ? renderStatus(summary, context.summaryColor) : renderFindings(summary);
      }
      if (command === "resume" || command === "cancel") {
        if (rest.length !== 1) throw new AnvilError("CONFIG_INVALID", `Usage: /anvil ${command} <run-id>`);
        runtime = await this.engineFactory(context);
        await runtime.lock.acquire(rest[0], undefined, (lockRunId) => isRunActive(runtime!, lockRunId));
        lockHeld = true;
        heartbeatTimer = setInterval(() => { void runtime?.lock.heartbeat().catch(() => undefined); }, 10_000);
        if (command === "resume") return renderStatus(await runtime.engine.resume(rest[0], context.progress), context.summaryColor);
        await runtime.engine.cancel(rest[0]);
        return renderStatus(runtime.engine.status(rest[0]), context.summaryColor);
      }
      throw new AnvilError("CONFIG_INVALID", `Unknown /anvil command: ${command}`);
    } catch (error) {
      if (error instanceof UpdateError) return `Update failed: ${error.message}`;
      const typed = error instanceof AnvilError ? error : new AnvilError("PERSISTENCE_ERROR", error instanceof Error ? error.message : String(error));
      return `ANVIL · ${typed.code}\n\n${typed.message}`;
    } finally {
      clearInterval(heartbeatTimer);
      if (runtime) {
        if (lockHeld) await runtime.lock.release();
        runtime.state.close();
      }
    }
  }
}
