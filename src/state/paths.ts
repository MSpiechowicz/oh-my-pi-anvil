import { mkdir } from "node:fs/promises";
import { realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { AnvilError } from "../util/errors.ts";

export async function canonicalRoot(root: string): Promise<string> {
  try { return await realpath(root); } catch { return path.resolve(root); }
}
export function runtimeRoot(workspaceRoot: string, configured: string): string { return path.isAbsolute(configured) ? configured : path.resolve(workspaceRoot, configured); }
export async function ensureRuntimeRoot(root: string): Promise<void> { await mkdir(root, { recursive: true }); await mkdir(path.join(root, "runs"), { recursive: true }); }
export function containedPath(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new AnvilError("ARTIFACT_CORRUPT", "Absolute artifact paths are not allowed");
  const resolvedRoot = path.resolve(root); const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new AnvilError("ARTIFACT_CORRUPT", "Artifact path escapes its run root");
  return resolved;
}
export async function assertSafeSymlink(root: string, target: string): Promise<void> {
  try { const info = await lstat(target); if (!info.isSymbolicLink()) return; const resolved = await realpath(target); containedPath(root, path.relative(root, resolved)); } catch (error) { if (error instanceof AnvilError) throw error; }
}
