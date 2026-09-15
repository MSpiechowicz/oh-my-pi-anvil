import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { AnvilError } from "../util/errors.ts";
import type { CheckDefinition } from "../workflow/types.ts";

const CHECK_NAME = /^(?:check|typecheck|type[-_]check|lint|test|build)(?:[:_-][a-z0-9][a-z0-9:_-]*)?$/i;
const UNSAFE_NAME = /(?:^|[:_-])(?:watch|dev|serve|start|fix|format|write|update|interactive|ui)(?:$|[:_-])/i;
const UNSAFE_ARGUMENT = /^(?:--(?:watch[^=]*|fix[^=]*|write|update[^=]*|hot|ui|interactive)(?:=.*)?|-[wu]+)$/i;
const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
type Manifest = Record<string, unknown>;
type Commands = Record<string, string>;

/** Inspect root manifests only; no project command is executed or configuration persisted. */
export async function discoverChecks(root: string): Promise<CheckDefinition[]> {
  const [pkg, denoJson] = await Promise.all([
    readManifest(path.join(root, "package.json")),
    readManifest(path.join(root, "deno.json"), true),
  ]);
  const deno = denoJson ?? await readManifest(path.join(root, "deno.jsonc"), true);
  const scripts = commandsFrom(pkg, "scripts", path.join(root, "package.json"));
  const tasks = commandsFrom(deno, "tasks", path.join(root, denoJson ? "deno.json" : "deno.jsonc"));
  const checks: CheckDefinition[] = [];
  const nativeNames = new Set<string>();
  for (const name of Object.keys(tasks).sort()) {
    if (!CHECK_NAME.test(name) || UNSAFE_NAME.test(name)) continue;
    const args = finiteArguments(tasks[name], scripts, tasks, new Set([name]));
    if (!args) continue;
    nativeNames.add(name);
    checks.push({ id: name, command: ["deno", "task", name, ...args], cwd: null, env: null, required: true, timeoutMs: null });
  }
  if (!pkg) return checks;
  const manager = await packageManager(root, pkg.packageManager);
  for (const name of Object.keys(scripts).sort()) {
    if (!CHECK_NAME.test(name) || UNSAFE_NAME.test(name) || nativeNames.has(name)) continue;
    // Native tasks are scheduled above, rather than through their package wrappers.
    if (deno && /(?:^|\s)deno\s+task(?:\s|$)/.test(scripts[name])) continue;
    const args = finiteArguments(scripts[name], scripts, tasks, new Set([name]));
    if (!args || !safeLifecycle(name, scripts, tasks, new Set([name]))) continue;
    const forwarded = args.length && manager === "npm" ? ["--", ...args] : args;
    checks.push({ id: name, command: [manager, "run", name, ...forwarded], cwd: null, env: null, required: true, timeoutMs: null });
  }
  return checks;
}

async function readManifest(file: string, jsonc = false): Promise<Manifest | undefined> {
  let raw: string;
  try { raw = await readFile(file, "utf8"); } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new AnvilError("CONFIG_INVALID", `Cannot read discovery manifest ${file}; fix its permissions or configure explicit checks.`, error);
  }
  try {
    // Preserve quoted strings while removing JSONC comments and trailing commas.
    if (jsonc) raw = raw.replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (token) => token.startsWith("/") ? " " : token)
      .replace(/"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g, (token) => token === "," ? "" : token);
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("manifest must be an object");
    return value as Manifest;
  } catch (error) {
    throw new AnvilError("CONFIG_INVALID", `Invalid discovery manifest ${file}: ${error instanceof Error ? error.message : String(error)}. Fix the manifest or configure explicit checks.`, error);
  }
}

function commandsFrom(manifest: Manifest | undefined, key: "scripts" | "tasks", file: string): Commands {
  const value = manifest?.[key];
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AnvilError("CONFIG_INVALID", `${file}: ${key} must be an object; fix the manifest or configure explicit checks.`);
  const commands: Commands = {};
  for (const [name, entry] of Object.entries(value)) {
    const command = key === "tasks" && entry && typeof entry === "object" && !Array.isArray(entry) && "command" in entry ? entry.command : entry;
    if (typeof command !== "string" || !command.trim()) throw new AnvilError("CONFIG_INVALID", `${file}: ${key}.${name} must contain a nonempty command string; fix the manifest or configure explicit checks.`);
    commands[name] = command;
  }
  return commands;
}

async function packageManager(root: string, declared: unknown): Promise<string> {
  if (declared !== undefined) {
    if (typeof declared !== "string" || !/^(npm|pnpm|yarn|bun)(?:@[^\s]+)?$/.test(declared)) {
      throw new AnvilError("CONFIG_INVALID", "package.json packageManager must name npm, pnpm, yarn, or bun (optionally @version); configure explicit checks for other managers.");
    }
    return declared.split("@")[0];
  }
  for (const [file, manager] of [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"], ["bun.lockb", "bun"], ["package-lock.json", "npm"], ["npm-shrinkwrap.json", "npm"]]) {
    try { await access(path.join(root, file)); return manager; } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return "npm";
}

/** Accept simple commands and && chains, never opaque shell programs or background jobs. */
function finiteArguments(command: string, scripts: Commands, tasks: Commands, visiting: Set<string>): string[] | undefined {
  if (/[`$\r\n]/.test(command)) return undefined;
  const tokenPattern = /\s+|"[^"\\]*"|'[^']*'|&&|[^\s"'&;|<>\\]+/gy;
  const segments: string[][] = [[]];
  let position = 0;
  for (let match = tokenPattern.exec(command); match; match = tokenPattern.exec(command)) {
    position = tokenPattern.lastIndex;
    const token = match[0];
    if (!token.trim()) continue;
    if (token === "&&") segments.push([]);
    else segments.at(-1)!.push(token.replace(/^(["'])(.*)\1$/, "$2"));
  }
  if (position !== command.length) return undefined;
  let extra: string[] = [];
  for (const segment of segments) {
    if (!segment.length || segment.some((token) => UNSAFE_ARGUMENT.test(token))) return undefined;
    let offset = 0;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[offset] ?? "")) offset++;
    if (segment[offset] === "cross-env" || segment[offset] === "env") {
      offset++;
      while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[offset] ?? "")) offset++;
    }
    const executable = segment[offset]?.replace(/^.*[\\/]/, "");
    const args = segment.slice(offset + 1);
    if (!executable || /^(?:watch|nodemon|concurrently|npm-run-all|run-p|sh|bash|zsh|fish)$/.test(executable)) return undefined;
    if (args.some((arg) => /^(?:watch|dev|serve|start|fix|write|update|ui)$/.test(arg))) return undefined;
    if (executable === "vite" && args[0] !== "build") return undefined;
    const manager = MANAGERS.some((name) => name === executable);
    if (manager || executable === "deno" && args[0] === "task") {
      const native = executable === "deno";
      const name = args[0] === "run" || args[0] === "task" ? args[1] : args[0];
      const available = native ? tasks : scripts;
      if (!name || UNSAFE_NAME.test(name) || !Object.hasOwn(available, name) || visiting.has(name)) return undefined;
      const next = new Set(visiting).add(name);
      const nested = finiteArguments(available[name], scripts, tasks, next);
      // Appending flags to an outer wrapper cannot reliably make nested runners finite.
      if (!nested || nested.length || !native && !safeLifecycle(name, scripts, tasks, next)) return undefined;
    }
    if (executable === "vitest") {
      if (args[0] && !args[0].startsWith("-") && args[0] !== "run" && args[0] !== "related") return undefined;
      if (args[0] !== "run" && !args.includes("--run")) extra = args.length ? ["--run"] : ["run"];
    } else if (executable === "jest" && !args.includes("--ci")) extra = ["--ci"];
    if (extra.length && segments.length !== 1) return undefined;
    if (executable === "prettier" && !args.some((arg) => ["--check", "--list-different", "-c", "-l"].includes(arg))) return undefined;
  }
  return extra;
}

function safeLifecycle(name: string, scripts: Commands, tasks: Commands, visiting: Set<string>): boolean {
  for (const hook of [`pre${name}`, `post${name}`]) {
    if (!Object.hasOwn(scripts, hook)) continue;
    if (visiting.has(hook)) return false;
    const args = finiteArguments(scripts[hook], scripts, tasks, new Set(visiting).add(hook));
    if (!args || args.length) return false;
  }
  return true;
}

