import path from "node:path";
import { loadConfig } from "./config/load.ts";
import { runtimeRoot, ensureRuntimeRoot } from "./state/paths.ts";
import { StateDatabase } from "./state/database.ts";
import { ArtifactStore } from "./state/artifact-store.ts";
import { WorkspaceLock } from "./state/lock.ts";
import { GitRevisionProvider } from "./git/revision.ts";
import { DeterministicCheckRunner } from "./runners/check-runner.ts";
import { OmpSubprocessRunner } from "./runners/omp-subprocess-runner.ts";
import { createOmpCompat, type OmpCompat } from "./runners/omp-compat.ts";
import { OptionalMemoryAdapter, type OmpMemoryRuntime } from "./memory/adapter.ts";
import { WorkflowEngine } from "./workflow/engine.ts";
import type { WorkflowConfig } from "./workflow/types.ts";

export interface Runtime { engine: WorkflowEngine; config: WorkflowConfig; state: StateDatabase; runtimeRoot: string; lock: WorkspaceLock; }
function memoryFromContext(context: unknown): OmpMemoryRuntime | undefined { if (!context || typeof context !== "object" || !("memory" in context)) return undefined; const candidate = context.memory; if (!candidate || typeof candidate !== "object" || !("search" in candidate) || !("save" in candidate) || typeof candidate.search !== "function" || typeof candidate.save !== "function") return undefined; return candidate as OmpMemoryRuntime; }
export async function createRuntime(workspaceRoot: string, context: unknown, explicitConfigPath?: string, host?: unknown): Promise<Runtime> {
  const loaded = await loadConfig(workspaceRoot, explicitConfigPath); const absoluteRuntimeRoot = runtimeRoot(workspaceRoot, loaded.persistence.root); await ensureRuntimeRoot(absoluteRuntimeRoot); const config = { ...loaded, persistence: { ...loaded.persistence, root: absoluteRuntimeRoot } };
  const state = await StateDatabase.open(absoluteRuntimeRoot); const artifacts = new ArtifactStore(state, (runId) => path.join(absoluteRuntimeRoot, "runs", runId)); const compat: OmpCompat = createOmpCompat(context, host); const agents = new OmpSubprocessRunner(compat); const discovered = Object.values(config.agents).map((agent) => agent.agent); await agents.validate(workspaceRoot, discovered);
  const memory = memoryFromContext(context); const engine = new WorkflowEngine({ config, state, artifacts, revisions: new GitRevisionProvider(workspaceRoot), agents, checks: new DeterministicCheckRunner(artifacts), memory: new OptionalMemoryAdapter(memory) }); return { engine, config, state, runtimeRoot: absoluteRuntimeRoot, lock: new WorkspaceLock(path.join(absoluteRuntimeRoot, "lock.json")) };
}
