import { access, mkdir, realpath, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import process from "node:process";
import path from "node:path";
import { AnvilError } from "../util/errors.ts";
function environment(name: string): string | undefined {
  try { return process.env[name] || undefined; } catch { return undefined; }
}


/** The user-wide Anvil configuration location. */
export function globalConfigPath(): string {
  const xdg = environment("XDG_CONFIG_HOME");
  if (xdg) return path.resolve(xdg, "omp", "anvil.yml");
  let home = environment("HOME");
  if (!home) {
    try { home = homedir(); } catch { home = path.resolve("."); }
  }
  return path.resolve(home, ".config", "omp", "anvil.yml");
}

/** The global OMP model-role mapping location. */
export function globalModelsConfigPath(): string {
  const profile = environment("OMP_PROFILE") ?? environment("PI_PROFILE");
  let home = environment("HOME");
  if (!home) {
    try { home = homedir(); } catch { home = path.resolve("."); }
  }
  if (profile && profile !== "default") return path.resolve(home, ".omp", "profiles", profile, "agent", "config.yml");
  const agentDirectory = environment("PI_CODING_AGENT_DIR");
  if (agentDirectory) return path.resolve(agentDirectory, "config.yml");
  return path.resolve(home, ".omp", "agent", "config.yml");
}

export function projectConfigPath(repositoryRoot: string): string {
  return path.join(path.resolve(repositoryRoot), ".omp", "anvil.yml");
}

/** Find the nearest Git-style repository root, if the workspace is inside one. */
export async function findRepositoryRoot(workspaceRoot: string): Promise<string | undefined> {
  let current = path.resolve(workspaceRoot);
  while (true) {
    try {
      await access(path.join(current, ".git"));
      return current;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}

/** Find the closest project overlay between a workspace and its repository root. */
export async function nearestProjectConfigPath(workspaceRoot: string): Promise<string | undefined> {
  const workspace = path.resolve(workspaceRoot);
  const repository = await findRepositoryRoot(workspace);
  if (!repository) return existingPathOrUndefined(projectConfigPath(workspace));
  let current = workspace;
  while (true) {
    const candidate = await existingPathOrUndefined(projectConfigPath(current));
    if (candidate) return candidate;
    if (current === repository) return undefined;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function existingPathOrUndefined(candidate: string): Promise<string | undefined> {
  try {
    await access(candidate);
    return candidate;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export const findProjectRoot = findRepositoryRoot;
// Short aliases keep the path vocabulary convenient for command integrations.
export const repositoryRoot = findRepositoryRoot;
export const nearestProjectConfig = nearestProjectConfigPath;

export function runtimeRoot(workspaceRoot: string, configured: string): string { return path.isAbsolute(configured) ? configured : path.resolve(workspaceRoot, configured); }
export async function ensureRuntimeRoot(root: string): Promise<void> { await mkdir(root, { recursive: true }); await mkdir(path.join(root, "runs"), { recursive: true }); }
export function containedPath(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new AnvilError("ARTIFACT_CORRUPT", "Absolute artifact paths are not allowed");
  const resolvedRoot = path.resolve(root); const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new AnvilError("ARTIFACT_CORRUPT", "Artifact path escapes its run root");
  return resolved;
}
export async function assertSafeSymlink(root: string, target: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  containedPath(resolvedRoot, path.relative(resolvedRoot, target));
  let current = path.parse(resolvedRoot).root;
  for (const part of path.resolve(target).slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new AnvilError("ARTIFACT_CORRUPT", `Symlink artifact path component is not accepted: ${current}`);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

export async function canonicalRoot(root: string): Promise<string> {
  try { return await realpath(root); } catch { return path.resolve(root); }
}
