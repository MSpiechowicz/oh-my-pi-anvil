import type { AgentRunRequest, AgentRunResult } from "../workflow/types.ts";

export interface OmpCompat {
  discoverAgents?: (cwd: string) => Promise<Array<{ name: string; disabled?: boolean }>>;
  execute?: <T>(request: AgentRunRequest) => Promise<AgentRunResult<T>>;
}

type AnyRecord = Record<string, unknown>;
type NativeSettings = AnyRecord & { get: (path: string) => unknown; override?: (path: string, value: unknown) => void };
type NativeTaskTool = { execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<unknown> };

const READ_ONLY_TOOL_NAMES: Record<string, true> = {
  read: true,
  grep: true,
  glob: true,
  web_search: true,
  ast_grep: true,
  ask: true,
  todo: true,
  recall: true,
  reflect: true,
  retain: true,
  memory_edit: true,
  checkpoint: true,
  rewind: true,
  yield: true,
};

// These are inspection capabilities, not a sandbox: the gate still rejects
// repository mutations and the assignment forbids unauthorized remote writes.
const VALIDATION_TOOL_NAMES: Record<string, true> = { bash: true, eval: true, github: true };

function asRecord(value: unknown): AnyRecord | undefined {
  if (value === null || (typeof value !== "object" && typeof value !== "function") || Array.isArray(value)) return undefined;
  return value as AnyRecord;
}

function invoke<T>(owner: AnyRecord, name: string, args: unknown[]): T | Promise<T> {
  const method = owner[name];
  if (typeof method !== "function") throw new Error(`OMP compatibility method is unavailable: ${name}`);
  return (method as (...values: unknown[]) => T).apply(owner, args);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeAgentRecords(value: unknown): AnyRecord[] {
  const container = Array.isArray(value) ? value : asRecord(value)?.agents;
  if (!Array.isArray(container)) throw new Error("OMP agent discovery returned no agent list");
  return container.map(asRecord).filter((agent): agent is AnyRecord => agent !== undefined && stringValue(agent.name) !== undefined);
}

async function discoverNativeAgents(host: AnyRecord, cwd: string): Promise<AnyRecord[]> {
  return normalizeAgentRecords(await invoke<unknown>(host, "discoverAgents", [cwd]));
}

async function loadSettings(host: AnyRecord, cwd: string): Promise<NativeSettings> {
  const settingsType = asRecord(host.Settings);
  if (!settingsType) throw new Error("OMP Settings API is unavailable");
  let settings: unknown;
  if (typeof settingsType.loadReadOnly === "function") {
    settings = await invoke<unknown>(settingsType, "loadReadOnly", [{ cwd }]);
  } else if (typeof settingsType.isolated === "function") {
    settings = await invoke<unknown>(settingsType, "isolated", [{}]);
  }
  const result = asRecord(settings);
  if (!result || typeof result.get !== "function") throw new Error("OMP Settings API could not create a settings instance");
  return result as NativeSettings;
}

function applySetting(settings: NativeSettings, path: string, value: unknown): void {
  if (typeof settings.override === "function") settings.override(path, value);
}

function configureSettings(settings: NativeSettings, request: AgentRunRequest): void {
  // Forge owns completion accounting, so a child must settle before the
  // workflow advances even when the host normally enables background tasks.
  applySetting(settings, "async.enabled", false);
  if (request.role === "security" || request.role === "review") {
    applySetting(settings, "github.enabled", true);
    applySetting(settings, "browser.enabled", true);
    // Do not inherit the parent's authenticated browser or visible tab.
    applySetting(settings, "browser.relay", false);
    applySetting(settings, "browser.cdpUrl", "");
    applySetting(settings, "browser.cmux", false);
  }
  if (request.isolation?.requested) {
    applySetting(settings, "task.isolation.enabled", true);
    applySetting(settings, "task.isolation.apply", request.isolation.apply ?? true);
    applySetting(settings, "task.isolation.merge", request.isolation.merge ?? "patch");
  }
}

function currentModelSelector(context: unknown): string | undefined {
  const model = asRecord(asRecord(context)?.model);
  const provider = stringValue(model?.provider);
  const id = stringValue(model?.id);
  return provider && id ? `${provider}/${id}` : undefined;
}

function effectiveAgent(agent: AnyRecord, request: AgentRunRequest): AnyRecord {
  if (!request.readOnly) return agent;
  const tools = Array.isArray(agent.tools)
    ? agent.tools.filter((tool): tool is string => typeof tool === "string" && (READ_ONLY_TOOL_NAMES[tool] === true || ((request.role === "security" || request.role === "review") && VALIDATION_TOOL_NAMES[tool] === true)))
    : [];
  if (tools.length === 0) {
    throw new Error(`Configured read-only agent "${String(agent.name)}" has no read-only tools`);
  }
  return { ...agent, tools };
}

function nativeExecutorOptions(context: unknown, request: AgentRunRequest, agent: AnyRecord, settings: NativeSettings): AnyRecord {
  const contextRecord = asRecord(context);
  const options: AnyRecord = {
    cwd: request.cwd,
    agent,
    task: request.assignment.trim(),
    assignment: request.assignment.trim(),
    context: request.context?.trim() || undefined,
    index: 0,
    id: request.attemptId,
    outputSchema: request.outputSchema,
    outputSchemaMode: request.schemaMode,
    outputSchemaSource: "caller",
    outputSchemaOverridesAgent: true,
    taskDepth: 0,
    enableLsp: true,
    enableIrc: false,
    enableMCP: false,
    restrictToolNames: true,
    keepAlive: false,
    parentAgentId: "Main",
    sessionFile: null,
    signal: request.signal,
    settings,
  };
  const modelRegistry = contextRecord?.modelRegistry;
  if (modelRegistry !== undefined) options.modelRegistry = modelRegistry;
  const getApiKey = contextRecord?.getApiKey;
  if (typeof getApiKey === "function") options.getApiKey = getApiKey;
  const parentModel = currentModelSelector(context);
  if (parentModel) options.parentActiveModelPattern = parentModel;
  return options;
}

function nativeTaskSession(context: unknown, request: AgentRunRequest, settings: NativeSettings): AnyRecord {
  const contextRecord = asRecord(context);
  const session: AnyRecord = {
    cwd: request.cwd,
    hasUI: false,
    canPromptUser: false,
    settings,
    getSessionFile: () => null,
    getSessionSpawns: () => "*",
    enableLsp: true,
    enableIrc: false,
    enableMCP: false,
    restrictToolNames: true,
    suppressSpawnAdvisory: true,
    getSessionId: () => null,
    getAgentId: () => "Main",
    isDisposed: () => request.signal?.aborted === true,
  };
  if (contextRecord?.modelRegistry !== undefined) session.modelRegistry = contextRecord.modelRegistry;
  const getApiKey = contextRecord?.getApiKey;
  if (typeof getApiKey === "function") session.getApiKey = getApiKey;
  const model = contextRecord?.model;
  if (model !== undefined) {
    session.getActiveModel = () => model;
    session.getActiveModelString = () => currentModelSelector(context);
    session.getModelString = () => currentModelSelector(context);
  }
  return session;
}

function parseJsonOutput(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function resultRecord(value: unknown): AnyRecord | undefined {
  const record = asRecord(value);
  const details = asRecord(record?.details);
  const results = details?.results;
  if (Array.isArray(results) && results.length > 0) return asRecord(results[0]);
  return record;
}

function resultText(value: unknown): string | undefined {
  const record = asRecord(value);
  const content = record?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => asRecord(part)?.text)
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .trim();
  return text || undefined;
}

function mapNativeResult<T>(request: AgentRunRequest, value: unknown): AgentRunResult<T> {
  const result = resultRecord(value);
  if (!result) {
    return failedResult(request, "OMP_TASK_EXECUTION_FAILED", resultText(value) ?? "OMP returned no subagent result");
  }

  const structuredOutput = asRecord(result.structuredOutput);
  const structuredStatus = stringValue(structuredOutput?.status);
  const hasStructuredData = structuredOutput ? Object.hasOwn(structuredOutput, "data") : false;
  const structuredData = hasStructuredData ? structuredOutput?.data : parseJsonOutput(result.output);
  const exitCode = numberValue(result.exitCode) ?? 1;
  const aborted = result.aborted === true;
  const rawError = stringValue(result.error);
  const schemaError = stringValue(structuredOutput?.error);
  const failureMessage = rawError ?? schemaError ?? stringValue(result.stderr) ?? resultText(value) ?? `OMP subagent exited with code ${exitCode}`;
  const schemaValid = structuredStatus === "valid" || (structuredStatus === undefined && structuredData !== undefined);
  const completed = !aborted && exitCode === 0 && !rawError && schemaValid;
  const input = numberValue(asRecord(result.usage)?.input);
  const output = numberValue(asRecord(result.usage)?.output);
  const cacheRead = numberValue(asRecord(result.usage)?.cacheRead);
  const cacheWrite = numberValue(asRecord(result.usage)?.cacheWrite);
  const total = numberValue(asRecord(result.usage)?.totalTokens) ?? numberValue(result.tokens) ?? (input ?? 0) + (output ?? 0);
  const requests = numberValue(result.requests) ?? numberValue(asRecord(result.usage)?.requests);
  const usage = { input, output, cacheRead, cacheWrite, total, requests };
  const status = aborted ? "aborted" : completed ? "completed" : "failed";
  return {
    status,
    agentName: stringValue(result.agent) ?? request.agentName,
    resolvedModel: stringValue(result.resolvedModel) ?? null,
    resolvedThinkingLevel: stringValue(result.resolvedThinkingLevel) ?? null,
    usage,
    durationMs: numberValue(result.durationMs),
    ...(completed ? { structured: structuredData as T } : {}),
    ...(status !== "completed"
      ? {
          error: {
            code: aborted ? "OMP_TASK_ABORTED" : structuredStatus === "invalid" || structuredStatus === "unavailable" ? "OMP_SCHEMA_INVALID" : "OMP_TASK_EXECUTION_FAILED",
            message: failureMessage,
          },
        }
      : {}),
  };
}

function failedResult<T>(request: AgentRunRequest, code: string, message: string, status: "failed" | "aborted" = "failed"): AgentRunResult<T> {
  return {
    status,
    agentName: request.agentName,
    usage: { requests: 0 },
    resolvedModel: null,
    resolvedThinkingLevel: null,
    error: { code, message },
  };
}

async function executeNativeSubprocess<T>(context: unknown, host: AnyRecord, request: AgentRunRequest): Promise<AgentRunResult<T>> {
  const agents = await discoverNativeAgents(host, request.cwd);
  const found = agents.find((agent) => agent.name === request.agentName);
  if (!found) return failedResult(request, "OMP_AGENT_NOT_FOUND", `Configured agent was not discovered: ${request.agentName}`);
  let agent: AnyRecord;
  try {
    agent = effectiveAgent(found, request);
  } catch (error) {
    return failedResult(request, "OMP_READ_ONLY_AGENT_REQUIRED", error instanceof Error ? error.message : String(error));
  }
  const settings = await loadSettings(host, request.cwd);
  configureSettings(settings, request);
  const raw = await invoke<unknown>(host, "runSubprocess", [nativeExecutorOptions(context, request, agent, settings)]);
  return mapNativeResult<T>(request, raw);
}

async function createNativeTaskTool(host: AnyRecord, session: AnyRecord): Promise<NativeTaskTool> {
  const taskType = asRecord(host.TaskTool);
  if (taskType && typeof taskType.create === "function") {
    return await invoke<NativeTaskTool>(taskType, "create", [session]);
  }
  const builtins = asRecord(host.BUILTIN_TOOLS);
  if (builtins && typeof builtins.task === "function") {
    return await invoke<NativeTaskTool>(builtins, "task", [session]);
  }
  throw new Error("OMP TaskTool API is unavailable");
}

async function executeNativeTask<T>(context: unknown, host: AnyRecord, request: AgentRunRequest): Promise<AgentRunResult<T>> {
  const settings = await loadSettings(host, request.cwd);
  configureSettings(settings, request);
  const task = await createNativeTaskTool(host, nativeTaskSession(context, request, settings));
  const handoff = request.context?.trim();
  const assignment = handoff ? `${request.assignment.trim()}\n\nForge handoff:\n${handoff}` : request.assignment.trim();
  const params: AnyRecord = {
    agent: request.agentName,
    task: assignment,
    outputSchema: request.outputSchema,
    schemaMode: request.schemaMode,
  };
  if (request.isolation?.requested) params.isolated = true;
  return mapNativeResult<T>(request, await task.execute(`anvil-${request.attemptId}`, params, request.signal));
}

export function createOmpCompat(context: unknown, host?: unknown): OmpCompat {
  const direct = asRecord(context);
  const directDiscover = direct?.discoverAgents;
  const directExecute = direct?.runSubprocess;
  if (direct && (typeof directDiscover === "function" || typeof directExecute === "function")) {
    return {
      discoverAgents: typeof directDiscover === "function"
        ? async (cwd) => normalizeAgentRecords(await invoke<unknown>(direct, "discoverAgents", [cwd])).map((agent) => ({ name: agent.name as string, disabled: agent.disabled === true }))
        : undefined,
      execute: typeof directExecute === "function"
        ? async <T>(request: AgentRunRequest) => await invoke<AgentRunResult<T>>(direct, "runSubprocess", [request])
        : undefined,
    };
  }

  const native = asRecord(host) ?? asRecord(direct?.host) ?? asRecord(direct?.omp) ?? asRecord(direct?.pi);
  if (!native) return {};
  const nativeDiscover = native.discoverAgents;
  const nativeExecute = native.runSubprocess;
  const hasTaskTool = Boolean(asRecord(native.TaskTool)?.create || asRecord(native.BUILTIN_TOOLS)?.task);
  if (typeof nativeDiscover !== "function" && !hasTaskTool) return {};
  return {
    discoverAgents: typeof nativeDiscover === "function"
      ? async (cwd) => (await discoverNativeAgents(native, cwd)).map((agent) => ({ name: agent.name as string, disabled: agent.disabled === true }))
      : undefined,
    execute: async <T>(request: AgentRunRequest) => {
      try {
        if (request.isolation?.requested) {
          if (!hasTaskTool) return failedResult<T>(request, "OMP_ISOLATION_UNAVAILABLE", "OMP TaskTool API is unavailable for isolated Forge execution");
          return await executeNativeTask<T>(context, native, request);
        }
        if (typeof nativeExecute !== "function") {
          return failedResult<T>(request, "OMP_EXECUTOR_UNAVAILABLE", "OMP subprocess executor is unavailable in this extension context");
        }
        return await executeNativeSubprocess<T>(context, native, request);
      } catch (error) {
        return failedResult<T>(request, "OMP_TASK_EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
      }
    },
  };
}
