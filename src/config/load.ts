import { DEFAULT_CONFIG } from "./defaults.ts";
import { validateConfig } from "./schema.ts";
import type { WorkflowConfig } from "../workflow/types.ts";
import { AnvilError } from "../util/errors.ts";

export async function loadConfig(root: string, explicitPath?: string): Promise<WorkflowConfig> {
  const path = explicitPath ?? `${root}/.omp/orchestrator.yml`;
  const file = Bun.file(path);
  if (!(await file.exists())) return validateConfig(structuredClone(DEFAULT_CONFIG));
  const raw = await file.text();
  const parsed = path.endsWith(".json") ? JSON.parse(raw) : parseSimpleYaml(raw);
  return validateConfig(mergeConfig(structuredClone(DEFAULT_CONFIG), parsed as Partial<WorkflowConfig>));
}

function mergeConfig(base: WorkflowConfig, input: Partial<WorkflowConfig>): WorkflowConfig {
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
    for (const [key, value] of Object.entries(b)) a[key] = value && typeof value === "object" && !Array.isArray(value) ? merge((a[key] as Record<string, unknown> | undefined) ?? {}, value as Record<string, unknown>) : value;
    return a;
  };
  return merge(base as unknown as Record<string, unknown>, input as unknown as Record<string, unknown>) as unknown as WorkflowConfig;
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
  if (value.startsWith("[") && value.endsWith("]")) return value.slice(1, -1).split(",").map((part) => parseScalar(part.trim()));
  return value;
}
