import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdtemp, open, readlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AnvilError } from "../util/errors.ts";
import { sha256 } from "../util/hash.ts";
import type { RevisionProvider, RevisionSnapshot, WorkspaceRevision } from "../workflow/types.ts";

type SnapshotFile = RevisionSnapshot["files"][number];
const DIFF_OPTIONS = ["--binary", "--no-ext-diff", "--no-textconv", "--no-color"];
const EMPTY_HASH = sha256(new Uint8Array());

function failure(message: string, cause?: unknown): AnvilError {
  return new AnvilError("AGENT_EXECUTION_FAILED", message, cause);
}

async function evidenceOperation<T>(operation: string, body: () => Promise<T>): Promise<T> {
  try { return await body(); }
  catch (error) {
    if (error instanceof AnvilError && error.code === "AGENT_EXECUTION_FAILED") throw error;
    throw failure(`Cannot ${operation}: ${error instanceof Error ? error.message : String(error)}. Restore the workspace or start a new run before retrying.`, error);
  }
}

// Ignore inherited Git routing/configuration and prevent optional index refreshes.
function gitBytes(root: string, args: string[], input?: Uint8Array): Buffer {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: os.devNull, GIT_CONFIG_GLOBAL: os.devNull, GIT_ATTR_NOSYSTEM: "1", LC_ALL: "C" });
  const config = ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${os.devNull}`, "-c", `core.attributesFile=${os.devNull}`];
  const execute = (command: string[], data?: Uint8Array) => execFileSync("git", ["-C", root, ...config, ...command], { env, encoding: "buffer", input: data, maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  if (args[0] === "diff") {
    // --no-ext-diff/--no-textconv do not disable clean/process filters.
    const names = execute(["config", "--null", "--name-only", "--list"]).toString("utf8").split("\0");
    for (const name of new Set(names)) {
      if (/^filter\..*\.(clean|smudge|process|required)$/i.test(name)) config.push("-c", `${name}=${name.toLowerCase().endsWith(".required") ? "false" : ""}`);
    }
  }
  return execute(args, input);
}

function records(bytes: Buffer): string[] {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) throw failure("Cannot capture non-UTF-8 Git paths safely. Rename these paths before starting a new run.");
  return text.split("\0").filter(Boolean);
}

function validPath(relative: string): boolean {
  return relative.length > 0 && !relative.includes("\0") && !relative.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git");
}

function makeSnapshot(format: RevisionSnapshot["format"], revisionId: string, head: string, files: SnapshotFile[]): RevisionSnapshot {
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const payload = { revisionId, head, format, files };
  return { ...payload, checksum: sha256(JSON.stringify(payload)) };
}

function verifySnapshot(snapshot: RevisionSnapshot, format: RevisionSnapshot["format"]): void {
  if (!snapshot || snapshot.format !== format || typeof snapshot.revisionId !== "string" || typeof snapshot.head !== "string" || !Array.isArray(snapshot.files)) throw failure("Review snapshot is missing or has an unsupported format. Restore the original evidence artifacts or start a new run.");
  let previous: string | undefined;
  for (const file of snapshot.files) {
    if (!file || typeof file.path !== "string" || !validPath(file.path) || (previous !== undefined && previous >= file.path) || !["100644", "100755", "120000"].includes(file.mode) || typeof file.contentBase64 !== "string" || Buffer.from(file.contentBase64, "base64").toString("base64") !== file.contentBase64) throw failure("Review snapshot contains invalid paths, modes, or contents. Restore the original evidence artifacts or start a new run.");
    previous = file.path;
  }
  const { revisionId, head, files } = snapshot;
  if (sha256(JSON.stringify({ revisionId, head, format, files })) !== snapshot.checksum) throw failure("Review snapshot checksum does not match. Restore the original evidence artifacts or start a new run.");
}

function revisionId(head: string, stagedSha256: string, unstagedSha256: string, untracked: Array<{ path: string; sha256: string; mode?: string }>, workspaceSha256?: string): string {
  return `wr1:${sha256(JSON.stringify({ version: 1, head, stagedSha256, unstagedSha256, untracked, ...(workspaceSha256 === undefined ? {} : { workspaceSha256 }) }))}`;
}

export interface RevisionOptions { ignore?: string[]; }
export class GitRevisionProvider implements RevisionProvider {
  constructor(private readonly root: string, private readonly options: RevisionOptions = {}) {}

  async current(): Promise<WorkspaceRevision> { return (await this.observe()).revision; }

  private async observe(): Promise<{ revision: WorkspaceRevision; files: SnapshotFile[] }> {
    return evidenceOperation("identify the workspace revision", async () => {
      const head = this.git(["rev-parse", "--verify", "HEAD"]).trim();
      const paths = this.diffPaths();
      const stagedSha256 = sha256(gitBytes(this.root, ["diff", "--cached", ...DIFF_OPTIONS, ...paths]));
      const unstagedSha256 = sha256(gitBytes(this.root, ["diff", ...DIFF_OPTIONS, ...paths]));
      const untracked = this.untracked();
      const { files, matchesIndex } = await this.workspaceFiles(untracked);
      const byPath = new Map(files.map((file) => [file.path, file]));
      const hashes: Array<{ path: string; sha256: string; mode?: string }> = [];
      for (const relative of untracked) {
        const file = byPath.get(relative);
        if (!file) throw failure(`Untracked path ${JSON.stringify(relative)} changed during revision capture. Retry when the workspace is stable.`);
        hashes.push({ path: relative, sha256: sha256(Buffer.from(file.contentBase64, "base64")), ...(file.mode === "100644" ? {} : { mode: file.mode }) });
      }
      if (head !== this.git(["rev-parse", "--verify", "HEAD"]).trim()) throw failure("HEAD moved while identifying the workspace revision. Retry when the workspace is stable.");
      // Only a byte-for-byte clean tree uses the original wr1 payload. Dirty
      // identities also bind raw contents, even when Git's stat cache or
      // built-in conversions hide a worktree change from its patch.
      const workspaceSha256 = matchesIndex && stagedSha256 === EMPTY_HASH && unstagedSha256 === EMPTY_HASH && untracked.length === 0 ? undefined : sha256(JSON.stringify(files));
      return { revision: { id: revisionId(head, stagedSha256, unstagedSha256, hashes, workspaceSha256), head, stagedSha256, unstagedSha256, untracked }, files };
    });
  }

  async changedFiles(from: string, to: string): Promise<string[]> {
    if (from === to) return [];
    return evidenceOperation("list workspace changes", async () => [...new Set([
      ...records(gitBytes(this.root, ["diff", "--name-only", "-z", ...DIFF_OPTIONS, "HEAD", ...this.diffPaths()])),
      ...this.untracked(),
    ])].sort());
  }

  async captureSnapshot(expectedRevisionId: string): Promise<RevisionSnapshot> {
    return evidenceOperation("capture review evidence", async () => {
      const before = await this.current();
      if (before.id !== expectedRevisionId) throw failure(`Workspace revision changed before snapshot capture (expected ${expectedRevisionId}, found ${before.id}). Retry the gate against the current revision.`);
      const captured = await this.observe();
      const after = await this.current();
      if (captured.revision.id !== expectedRevisionId || after.id !== expectedRevisionId || after.head !== before.head) throw failure("Workspace changed during snapshot capture. Retry the gate when the workspace is stable; no snapshot was accepted.");
      return makeSnapshot("git-tree-v1", before.id, before.head, captured.files);
    });
  }

  async recoverSnapshot(id: string, head: string): Promise<RevisionSnapshot> {
    return evidenceOperation("recover the historical baseline", async () => {
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head) || id !== revisionId(head, EMPTY_HASH, EMPTY_HASH, [])) {
        // A strengthened exact identity can also prove a restored/current
        // baseline, but never substitute today's bytes for an unknown old one.
        const current = await this.current();
        if (current.id === id && current.head === head) return this.captureSnapshot(id);
        throw failure("The baseline snapshot is missing and its revision is neither the exact current workspace nor a provably clean historical wr1 revision. Dirty or unknown historical baselines cannot be reconstructed from HEAD. Restore the original baseline artifact or start a new run.");
      }
      if (this.git(["rev-parse", "--verify", `${head}^{commit}`]).trim() !== head) throw failure("The historical baseline commit is unavailable. Restore its Git objects or start a new run.");
      const files: SnapshotFile[] = [];
      for (const record of records(gitBytes(this.root, ["ls-tree", "-r", "-z", head]))) {
        const match = /^(\d{6}) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(record);
        if (!match) throw failure("Cannot parse the historical Git tree safely.");
        const [, mode, type, object, relative] = match;
        if (this.isIgnored(relative)) continue;
        if (!validPath(relative) || type !== "blob" || !["100644", "100755", "120000"].includes(mode)) throw failure(`Cannot recover unsupported historical entry ${JSON.stringify(relative)} (mode ${mode}). Materialize submodules as ordinary files or start a supported workspace run.`);
        files.push({ path: relative, mode: mode as SnapshotFile["mode"], contentBase64: gitBytes(this.root, ["cat-file", "blob", object]).toString("base64") });
      }
      return makeSnapshot("git-tree-v1", id, head, files);
    });
  }

  async reviewDiff(base: RevisionSnapshot, target: RevisionSnapshot): Promise<{ patch: string; changedFiles: string[] }> {
    return evidenceOperation("render the exact-workspace review diff", async () => {
      verifySnapshot(base, "git-tree-v1");
      verifySnapshot(target, "git-tree-v1");
      const directory = await mkdtemp(path.join(os.tmpdir(), "anvil-review-diff-"));
      try {
        // Only this disposable bare object store is written; no real index/worktree,
        // repository attributes, filters, templates, or hooks participate in review.
        gitBytes(directory, ["init", "--bare", "--template=", "--object-format=sha1", "."]);
        const objects = new Map<string, string>();
        const before = this.writeTree(directory, base.files, objects);
        const after = this.writeTree(directory, target.files, objects);
        const bytes = gitBytes(directory, ["diff", ...DIFF_OPTIONS, "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", before, after]);
        const patch = bytes.toString("utf8");
        if (!Buffer.from(patch).equals(bytes)) throw failure("Review diff contains non-UTF-8 text that cannot be rendered losslessly. Convert the affected text files to UTF-8 before retrying; binary file contents remain preserved in the snapshots.");
        const changedFiles = records(gitBytes(directory, ["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--no-renames", before, after]));
        return { patch, changedFiles };
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
  }

  private writeTree(directory: string, files: SnapshotFile[], objects: Map<string, string>): string {
    interface Tree { files: Array<{ name: string; mode: string; object: string }>; children: Map<string, Tree>; }
    const root: Tree = { files: [], children: new Map() };
    for (const file of files) {
      const parts = file.path.split("/");
      let tree = root;
      for (const part of parts.slice(0, -1)) {
        if (tree.files.some((entry) => entry.name === part)) throw failure("Snapshot contains a file/directory path collision.");
        let child = tree.children.get(part);
        if (!child) { child = { files: [], children: new Map() }; tree.children.set(part, child); }
        tree = child;
      }
      const name = parts[parts.length - 1];
      if (tree.children.has(name)) throw failure("Snapshot contains a file/directory path collision.");
      let object = objects.get(file.contentBase64);
      if (!object) {
        object = gitBytes(directory, ["hash-object", "-w", "--stdin", "--no-filters"], Buffer.from(file.contentBase64, "base64")).toString("utf8").trim();
        objects.set(file.contentBase64, object);
      }
      tree.files.push({ name, mode: file.mode, object });
    }
    const write = (tree: Tree): string => {
      const entries = tree.files.map((file) => `${file.mode} blob ${file.object}\t${file.name}\0`);
      for (const [name, child] of tree.children) entries.push(`040000 tree ${write(child)}\t${name}\0`);
      return gitBytes(directory, ["mktree", "-z"], Buffer.from(entries.join(""))).toString("utf8").trim();
    };
    return write(root);
  }

  private async workspaceFiles(untracked: string[]): Promise<{ files: SnapshotFile[]; matchesIndex: boolean }> {
    const index = new Map<string, { mode: SnapshotFile["mode"]; object: string }>();
    for (const record of records(gitBytes(this.root, ["ls-files", "--stage", "-z"]))) {
      const match = /^(\d{6}) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/.exec(record);
      if (!match) throw failure("Cannot parse the workspace index safely.");
      const [, mode, object, stage, relative] = match;
      if (this.isIgnored(relative)) continue;
      if (stage !== "0") throw failure(`Cannot snapshot unresolved merge entry ${JSON.stringify(relative)}. Resolve the merge before retrying.`);
      if (!["100644", "100755", "120000"].includes(mode)) throw failure(`Cannot snapshot ${JSON.stringify(relative)} (mode ${mode}): submodule contents are not durable workspace evidence. Use ordinary tracked files instead.`);
      index.set(relative, { mode: mode as SnapshotFile["mode"], object });
    }
    for (const record of records(gitBytes(this.root, ["ls-files", "-v", "-z"]))) {
      if (!this.isIgnored(record.slice(2)) && (record[0] === "S" || record[0] !== record[0].toUpperCase())) throw failure(`Cannot prove exact revision identity for skip-worktree/assume-unchanged path ${JSON.stringify(record.slice(2))}. Clear these index flags before retrying.`);
    }
    const filemode = this.git(["config", "--type=bool", "--default=true", "--get", "core.filemode"]).trim() !== "false";
    const files: SnapshotFile[] = [];
    let matchesIndex = true;
    for (const relative of new Set([...index.keys(), ...untracked])) {
      const file = await this.workspaceFile(relative);
      if (!file) { matchesIndex = false; continue; }
      const entry = index.get(relative);
      if (!filemode && entry && entry.mode !== "120000" && file.mode !== "120000") file.mode = entry.mode;
      if (entry) {
        const content = Buffer.from(file.contentBase64, "base64");
        const object = createHash(entry.object.length === 64 ? "sha256" : "sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
        if (object !== entry.object || file.mode !== entry.mode) matchesIndex = false;
      } else { matchesIndex = false; }
      files.push(file);
    }
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { files, matchesIndex };
  }

  private async workspaceFile(relative: string): Promise<SnapshotFile | undefined> {
    if (!validPath(relative)) throw failure(`Cannot safely read workspace path ${JSON.stringify(relative)}.`);
    try {
      // A tracked directory can have been replaced with an untracked symlink.
      // Such descendants are deleted, not permission to follow that symlink.
      let parent = this.root;
      for (const part of relative.split("/").slice(0, -1)) {
        parent = path.join(parent, part);
        if (!(await lstat(parent)).isDirectory()) return undefined;
      }
      const absolute = path.join(this.root, relative);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) return { path: relative, mode: "120000", contentBase64: Buffer.from(await readlink(absolute, { encoding: "buffer" })).toString("base64") };
      if (stat.isDirectory()) return undefined;
      if (!stat.isFile()) throw failure(`Unsupported workspace entry ${JSON.stringify(relative)}. Only ordinary files and symlinks can be captured.`);
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || stat.ino !== opened.ino || stat.dev !== opened.dev) throw failure(`Workspace path ${JSON.stringify(relative)} changed during capture. Retry when stable.`);
        const contents = await handle.readFile();
        const finished = await handle.stat();
        if (opened.size !== finished.size || opened.mtimeMs !== finished.mtimeMs || opened.ctimeMs !== finished.ctimeMs) throw failure(`Workspace path ${JSON.stringify(relative)} changed while its bytes were read. Retry when stable.`);
        return { path: relative, mode: opened.mode & 0o100 ? "100755" : "100644", contentBase64: contents.toString("base64") };
      } finally { await handle.close(); }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return undefined;
      throw error;
    }
  }

  private untracked(): string[] { return records(gitBytes(this.root, ["ls-files", "--others", "--exclude-standard", "-z"])).filter((file) => !this.isIgnored(file)).sort(); }
  private ignorePrefixes(): string[] { return [".omp/.anvil/", ...(this.options.ignore ?? [])].map((prefix) => prefix.endsWith("/**") ? prefix.slice(0, -3) : prefix); }
  private isIgnored(file: string): boolean { return this.ignorePrefixes().some((prefix) => file.startsWith(prefix)); }
  private diffPaths(): string[] {
    // Non-glob pathspec wildcards match slashes, retaining the existing prefix
    // ignore semantics for both tracked changes and untracked file enumeration.
    return ["--", ".", ...this.ignorePrefixes().map((prefix) => `:(exclude)${prefix.replace(/[\\*?\[\]]/g, "\\$&")}*`)];
  }
  private git(args: string[]): string { return gitBytes(this.root, args).toString("utf8"); }
}

export class StaticRevisionProvider implements RevisionProvider {
  constructor(private revision: WorkspaceRevision) {}
  async current(): Promise<WorkspaceRevision> { return structuredClone(this.revision); }
  async changedFiles(from: string, to: string): Promise<string[]> { return from === to ? [] : [...this.revision.untracked]; }
  async captureSnapshot(expectedRevisionId: string): Promise<RevisionSnapshot> {
    if (this.revision.id !== expectedRevisionId) throw failure(`Synthetic revision changed before snapshot capture (expected ${expectedRevisionId}, found ${this.revision.id}).`);
    return makeSnapshot("static-v1", this.revision.id, this.revision.head, [...new Set(this.revision.untracked)].map((relative) => ({ path: relative, mode: "100644", contentBase64: Buffer.from(this.revision.id).toString("base64") })));
  }
  async recoverSnapshot(id: string, head: string): Promise<RevisionSnapshot> {
    if (this.revision.id === id && this.revision.head === head) return this.captureSnapshot(id);
    return makeSnapshot("static-v1", id, head, []);
  }
  async reviewDiff(base: RevisionSnapshot, target: RevisionSnapshot): Promise<{ patch: string; changedFiles: string[] }> {
    verifySnapshot(base, "static-v1"); verifySnapshot(target, "static-v1");
    const before = new Map(base.files.map((file) => [file.path, file.contentBase64]));
    const after = new Map(target.files.map((file) => [file.path, file.contentBase64]));
    const changedFiles = [...new Set([...before.keys(), ...after.keys()])].filter((file) => before.get(file) !== after.get(file)).sort();
    return { patch: base.revisionId === target.revisionId ? "" : `Synthetic review diff: ${base.revisionId} (${base.head}) -> ${target.revisionId} (${target.head})\n${changedFiles.map((file) => `Changed: ${JSON.stringify(file)}\n`).join("")}`, changedFiles };
  }
  set(revision: WorkspaceRevision): void { this.revision = revision; }
}
