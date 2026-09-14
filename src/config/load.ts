import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONFIG } from "./defaults.ts";
import { validateConfig } from "./schema.ts";
import type { WorkflowConfig } from "../workflow/types.ts";
import { AnvilError } from "../util/errors.ts";
import { globalConfigPath, nearestProjectConfigPath } from "../state/paths.ts";

export async function loadConfig(root: string, explicitPath?: string): Promise<WorkflowConfig> {
  const layers: Array<Record<string, unknown> | undefined> = [
    await readConfigFile(globalConfigPath()),
  ];
  const configPath = explicitPath ?? await nearestProjectConfigPath(root);
  if (configPath) layers.push(await readConfigFile(configPath));
  let merged = structuredClone(DEFAULT_CONFIG);
  for (const layer of layers) if (layer) merged = mergeConfig(merged, layer);
  return validateConfig(merged);
}
function mergeConfig(base: WorkflowConfig, input: Record<string, unknown>): WorkflowConfig {
  const merge = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(source)) {
      if (isRecord(value)) {
        const existing = target[key];
        const child = isRecord(existing) ? existing : {};
        merge(child, value);
        target[key] = child;
      } else {
        target[key] = value;
      }
    }
  };
  merge(base as unknown as Record<string, unknown>, input);
  return base;
}

async function readConfigFile(configPath: string): Promise<Record<string, unknown> | undefined> {
  let raw: string;
  try {
    await access(configPath);
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  try {
    const parsed: unknown = path.extname(configPath).toLowerCase() === ".json" || raw.trim().startsWith("{")
      ? JSON.parse(raw)
      : parseSimpleYaml(raw);
    if (!isRecord(parsed)) {
      throw new AnvilError("CONFIG_INVALID", `Configuration must be an object: ${configPath}`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof AnvilError) throw error;
    throw new AnvilError("CONFIG_INVALID", `Invalid configuration: ${configPath}`, error);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSimpleYaml(text: string): Record<string, unknown> {
  try { if (text.trim().startsWith("{")) return JSON.parse(text); } catch (error) { throw new AnvilError("CONFIG_INVALID", "Invalid JSON workflow configuration", error); }
  const root: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/).map((sourceLine) => sourceLine.replace(/\s+#.*$/, "")).filter((line) => line.trim() && !line.trim().startsWith("#"));
  const stack: Array<{ indent: number; value: Record<string, unknown> | unknown[] }> = [{ indent: -1, value: root }];
  for (let index = 0; index < lines.length; index += 1) {
    const sourceLine = lines[index]; const indent = sourceLine.length - sourceLine.trimStart().length; const trimmed = sourceLine.trim();
    while (stack.length > 1 && indent <= stack.at(-1)!.indent) stack.pop();
    const parent = stack.at(-1)!.value;
    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(parent)) throw new AnvilError("CONFIG_INVALID", `List item has no list parent: ${sourceLine}`);
      const item = trimmed.slice(2).trim(); const match = item.match(/^([^:]+):(?:\s*(.*))?$/); if (!match) { parent.push(parseScalar(item)); continue; }
      const object: Record<string, unknown> = {}; parent.push(object); const value = (match[2] ?? "").trim(); object[match[1].trim()] = value ? parseScalar(value) : {};
      if (!value) stack.push({ indent, value: object[match[1].trim()] as Record<string, unknown> }); else stack.push({ indent, value: object });
      continue;
    }
    const match = trimmed.match(/^([^:]+):(?:\s*(.*))?$/); if (!match || Array.isArray(parent)) throw new AnvilError("CONFIG_INVALID", `Unsupported YAML line: ${sourceLine}`);
    const key = match[1].trim(); const value = (match[2] ?? "").trim();
    if (value) { parent[key] = parseScalar(value); continue; }
    const next = lines[index + 1]?.trim() ?? ""; const container: Record<string, unknown> | unknown[] = next.startsWith("- ") ? [] : {}; parent[key] = container; stack.push({ indent, value: container });
  }
  return root;
}

function parseScalar(value: string): unknown {
  if (value === "true") return true; if (value === "false") return false; if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  if (value.startsWith("[") && value.endsWith("]")) {
    const items = value.slice(1, -1).trim();
    return items ? items.split(",").map((part) => parseScalar(part.trim())) : [];
  }
  return value;
}
