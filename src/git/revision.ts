import { readFile } from "node:fs/promises";
import path from "node:path";
import { AnvilError } from "../util/errors.ts";
import { sha256 } from "../util/hash.ts";
import type { RevisionProvider, WorkspaceRevision } from "../workflow/types.ts";

export interface RevisionOptions { ignore?: string[]; }
export class GitRevisionProvider implements RevisionProvider {
  constructor(private readonly root: string, private readonly options: RevisionOptions = {}) {}
  async current(): Promise<WorkspaceRevision> {
    const head = this.git(["rev-parse", "HEAD"]).trim();
    const staged = this.gitBytes(["diff", "--cached", "--binary", "--no-ext-diff"]);
    const unstaged = this.gitBytes(["diff", "--binary", "--no-ext-diff"]);
    const untracked = this.git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean).filter((file) => !this.isIgnored(file)).sort();
    const hashes: Array<{ path: string; sha256: string }> = [];
    for (const relative of untracked) hashes.push({ path: relative, sha256: sha256(new Uint8Array(await readFile(path.join(this.root, relative)))) });
    const id = `wr1:${sha256(JSON.stringify({ version: 1, head, stagedSha256: sha256(staged), unstagedSha256: sha256(unstaged), untracked: hashes }))}`;
    return { id, head, stagedSha256: sha256(staged), unstagedSha256: sha256(unstaged), untracked };
  }
  async changedFiles(from: string, to: string): Promise<string[]> { if (from === to) return []; return this.git(["diff", "--name-only", "--no-ext-diff", "HEAD"]).split(/\r?\n/).filter(Boolean).filter((file) => !this.isIgnored(file)); }
  private isIgnored(file: string): boolean { return [".omp/.orchestrator/", ...(this.options.ignore ?? [])].some((prefix) => prefix.endsWith("/**") ? file.startsWith(prefix.slice(0, -3)) : file === prefix || file.startsWith(prefix)); }
  private git(args: string[]): string { const result = Bun.spawnSync({ cmd: ["git", "-C", this.root, ...args], stdout: "pipe", stderr: "pipe" }); if (result.exitCode !== 0) throw new AnvilError("WORKSPACE_NOT_GIT", new TextDecoder().decode(result.stderr).trim() || "Workspace is not a Git repository"); return new TextDecoder().decode(result.stdout); }
  private gitBytes(args: string[]): Uint8Array { const result = Bun.spawnSync({ cmd: ["git", "-C", this.root, ...args], stdout: "pipe", stderr: "pipe" }); if (result.exitCode !== 0) throw new AnvilError("WORKSPACE_NOT_GIT", new TextDecoder().decode(result.stderr).trim() || "Git command failed"); return result.stdout; }
}

export class StaticRevisionProvider implements RevisionProvider {
  constructor(private revision: WorkspaceRevision) {}
  async current(): Promise<WorkspaceRevision> { return structuredClone(this.revision); }
  async changedFiles(from: string, to: string): Promise<string[]> { return from === to ? [] : this.revision.untracked; }
  set(revision: WorkspaceRevision): void { this.revision = revision; }
}
