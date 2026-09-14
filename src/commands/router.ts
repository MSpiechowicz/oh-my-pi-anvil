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
import type { WorkspaceLock } from "../state/lock.ts";

export interface CommandContext { cwd: string; runtimeContext?: unknown; respond?: (message: string) => void | Promise<void>; }
interface RuntimeHandle { engine: WorkflowEngine; state: { close(): void }; lock: WorkspaceLock; runtimeRoot?: string; }

async function configurationLocations(cwd: string): Promise<ConfigurationLocations> {
  const projectRoot = await findRepositoryRoot(cwd);
  const existingProject = await nearestProjectConfigPath(cwd);
  const projectConfig = existingProject ?? (projectRoot ? projectConfigPath(projectRoot) : projectConfigPath(cwd));
  const globalConfig = globalConfigPath();
  let globalConfigPresent = false;
  let effectiveRuntimeRoot = path.resolve(cwd, ".omp", ".anvil");
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
    const objective = raw.trim();
    if (!objective || objective === "help") return renderForgeHelp();
    let runtime: RuntimeHandle | undefined;
    let lockHeld = false;
    try {
      runtime = await this.engineFactory(context);
      await runtime.lock.acquire(`pending_${crypto.randomUUID()}`);
      lockHeld = true;
      return renderStatus(await runtime.engine.start({ objective, workspaceRoot: context.cwd }));
    } catch (error) {
      const typed = error instanceof AnvilError ? error : new AnvilError("PERSISTENCE_ERROR", error instanceof Error ? error.message : String(error));
      return `ANVIL · ${typed.code}\n\n${typed.message}`;
    } finally {
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
        return command === "status" ? renderStatus(summary) : renderFindings(summary);
      }
      if (command === "resume" || command === "cancel") {
        if (rest.length !== 1) throw new AnvilError("CONFIG_INVALID", `Usage: /anvil ${command} <run-id>`);
        runtime = await this.engineFactory(context);
        await runtime.lock.acquire(rest[0]);
        lockHeld = true;
        if (command === "resume") return renderStatus(await runtime.engine.resume(rest[0]));
        await runtime.engine.cancel(rest[0]);
        return renderStatus(runtime.engine.status(rest[0]));
      }
      throw new AnvilError("CONFIG_INVALID", `Unknown /anvil command: ${command}`);
    } catch (error) {
      if (error instanceof UpdateError) return `ANVIL · UPDATE FAILED\n\n${error.message}`;
      const typed = error instanceof AnvilError ? error : new AnvilError("PERSISTENCE_ERROR", error instanceof Error ? error.message : String(error));
      return `ANVIL · ${typed.code}\n\n${typed.message}`;
    } finally {
      if (runtime) {
        if (lockHeld) await runtime.lock.release();
        runtime.state.close();
      }
    }
  }
}
