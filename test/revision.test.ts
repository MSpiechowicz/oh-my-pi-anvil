import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "./test-helpers.ts";
import { GitRevisionProvider } from "../src/git/revision.ts";
import { AnvilError } from "../src/util/errors.ts";
import { sha256 } from "../src/util/hash.ts";
import type { RevisionSnapshot, WorkspaceRevision } from "../src/workflow/types.ts";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, "-c", `core.hooksPath=${os.devNull}`, ...args], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull }, stdio: ["pipe", "pipe", "pipe"] });
}

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-revision-test-"));
  git(root, "init", "--template=", ".");
  git(root, "config", "user.name", "Revision Test");
  git(root, "config", "user.email", "revision@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "config", "core.filemode", "true");
  await writeFile(path.join(root, "source.txt"), "committed original\n");
  git(root, "add", "source.txt");
  git(root, "commit", "-m", "seed");
  return root;
}

function evidenceError(error: unknown): boolean {
  return error instanceof AnvilError && error.code === "AGENT_EXECUTION_FAILED";
}

describe("durable exact-workspace revision evidence", () => {
  test("diffs durable dirty baselines across HEAD movement without index writes or runtime noise", async () => {
    const root = await repository();
    try {
      await mkdir(path.join(root, ".omp", ".anvil"), { recursive: true });
      await mkdir(path.join(root, "custom-runtime"));
      await writeFile(path.join(root, ".omp", ".anvil", "tracked.log"), "runtime initial\n");
      await writeFile(path.join(root, "custom-runtime", "tracked.log"), "custom initial\n");
      await writeFile(path.join(root, ".gitignore"), "*.ignored\n");
      await writeFile(path.join(root, "delete.txt"), "remove me\n");
      await writeFile(path.join(root, "executable.sh"), "echo test\n");
      git(root, "add", "."); git(root, "commit", "-m", "seed boundaries");
      await writeFile(path.join(root, "source.txt"), "staged before run\n");
      git(root, "add", "source.txt");
      await writeFile(path.join(root, "source.txt"), "dirty baseline bytes\n");
      await writeFile(path.join(root, "preexisting.txt"), "preexisting untracked\n");
      await writeFile(path.join(root, "preexisting.bin"), new Uint8Array([0, 1, 255]));
      const provider = new GitRevisionProvider(root, { ignore: ["custom-runtime/**"] });
      const baselineRevision = await provider.current();
      const index = await readFile(path.join(root, ".git", "index"));
      const baseline = await provider.captureSnapshot(baselineRevision.id);
      assert.deepEqual(await readFile(path.join(root, ".git", "index")), index);
      assert.equal(await readFile(path.join(root, "source.txt"), "utf8"), "dirty baseline bytes\n");

      await writeFile(path.join(root, ".omp", ".anvil", "tracked.log"), "runtime later\n");
      await writeFile(path.join(root, ".omp", ".anvil", "new.log"), "runtime new\n");
      await writeFile(path.join(root, "custom-runtime", "tracked.log"), "custom later\n");
      await writeFile(path.join(root, "custom-runtime", "new.log"), "custom new\n");
      await writeFile(path.join(root, "build.ignored"), "ignored by Git\n");
      assert.equal((await provider.current()).id, baselineRevision.id);

      await writeFile(path.join(root, "source.txt"), "implementation bytes\n");
      await rm(path.join(root, "delete.txt"));
      await chmod(path.join(root, "executable.sh"), 0o755);
      git(root, "add", "source.txt", "delete.txt", "executable.sh");
      git(root, "commit", "-m", "implementation moved HEAD");
      const unusual = "new file\nwith tab\t.txt";
      await writeFile(path.join(root, unusual), "new untracked text\n");
      await writeFile(path.join(root, "new.bin"), new Uint8Array([0, 128, 255, 10]));
      await symlink("/outside/workspace/does-not-exist", path.join(root, "new-link"));
      const targetRevision = await provider.current();
      assert.notEqual(targetRevision.head, baselineRevision.head);
      const targetIndex = await readFile(path.join(root, ".git", "index"));
      const target = await provider.captureSnapshot(targetRevision.id);
      const expectedFiles = ["delete.txt", "executable.sh", "new-link", "new.bin", unusual, "source.txt"].sort();
      const restoredBase: RevisionSnapshot = JSON.parse(JSON.stringify(baseline));
      const restoredTarget: RevisionSnapshot = JSON.parse(JSON.stringify(target));
      const first = await provider.reviewDiff(restoredBase, restoredTarget);
      assert.deepEqual([...first.changedFiles].sort(), expectedFiles);
      assert.match(first.patch, /-dirty baseline bytes/);
      assert.match(first.patch, /\+implementation bytes/);
      assert.doesNotMatch(first.patch, /staged before run|committed original|preexisting|runtime/);
      assert.match(first.patch, /GIT binary patch/);
      assert.match(first.patch, /old mode 100644\nnew mode 100755/);
      assert.match(first.patch, /new file mode 120000/);
      assert.match(first.patch, /\+\/outside\/workspace\/does-not-exist/);
      assert.deepEqual(await readFile(path.join(root, ".git", "index")), targetIndex);
      assert.equal((await provider.current()).id, targetRevision.id);

      // The serialized snapshots, not any original Git object or provider cache,
      // are the sole source for a resumed review.
      await rm(path.join(root, ".git"), { recursive: true, force: true });
      const recreated = new GitRevisionProvider(root);
      assert.deepEqual(await recreated.reviewDiff(restoredBase, restoredTarget), first);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("recovers only clean legacy history or an exactly restored strengthened baseline", async () => {
    const root = await repository();
    try {
      const provider = new GitRevisionProvider(root);
      const clean = await provider.current();
      const empty = sha256(new Uint8Array());
      const historicalId = `wr1:${sha256(JSON.stringify({ version: 1, head: clean.head, stagedSha256: empty, unstagedSha256: empty, untracked: [] }))}`;
      assert.equal(clean.id, historicalId);
      const cleanSnapshot = await provider.captureSnapshot(clean.id);
      await writeFile(path.join(root, "source.txt"), "dirty baseline\n");
      const dirty = await provider.current();
      const dirtySnapshot = await provider.captureSnapshot(dirty.id);
      assert.deepEqual(await new GitRevisionProvider(root).recoverSnapshot(dirty.id, dirty.head), dirtySnapshot);
      const legacyDirtyId = `wr1:${sha256(JSON.stringify({ version: 1, head: dirty.head, stagedSha256: dirty.stagedSha256, unstagedSha256: dirty.unstagedSha256, untracked: [] }))}`;
      await assert.rejects(provider.recoverSnapshot(legacyDirtyId, dirty.head), evidenceError);
      git(root, "add", "source.txt"); git(root, "commit", "-m", "move HEAD");
      await writeFile(path.join(root, "source.txt"), "later work\n");
      assert.deepEqual(await new GitRevisionProvider(root).recoverSnapshot(historicalId, clean.head), cleanSnapshot);
      await assert.rejects(provider.recoverSnapshot(dirty.id, dirty.head), evidenceError);
      await assert.rejects(provider.recoverSnapshot("wr1:unknown", clean.head), evidenceError);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects stale ids and changes between capture observations", async () => {
    const root = await repository();
    try {
      const provider = new GitRevisionProvider(root);
      const before = await provider.current();
      await writeFile(path.join(root, "source.txt"), "changed before capture\n");
      await assert.rejects(provider.captureSnapshot(before.id), evidenceError);
      const expected = (await provider.current()).id;
      class RacingProvider extends GitRevisionProvider {
        calls = 0;
        override async current(): Promise<WorkspaceRevision> {
          if (++this.calls === 2) await writeFile(path.join(root, "source.txt"), "changed during capture\n");
          return super.current();
        }
      }
      await assert.rejects(new RacingProvider(root).captureSnapshot(expected), evidenceError);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("binds raw bytes hidden by Git newline conversion and never invokes repository executables", async () => {
    const root = await repository();
    try {
      await writeFile(path.join(root, ".gitattributes"), "source.txt text eol=lf filter=trap diff=trap\n");
      git(root, "add", ".gitattributes"); git(root, "commit", "-m", "attributes");
      const marker = path.join(root, "executed-marker");
      const command = `touch ${JSON.stringify(marker)}`;
      for (const name of ["filter.trap.clean", "filter.trap.smudge", "filter.trap.process", "diff.trap.command", "diff.trap.textconv", "diff.external", "core.fsmonitor"]) git(root, "config", name, command);
      git(root, "config", "filter.trap.required", "true");
      const provider = new GitRevisionProvider(root);
      const before = await provider.current();
      const baseline = await provider.captureSnapshot(before.id);
      await writeFile(path.join(root, "source.txt"), "committed original\r\n");
      const after = await provider.current();
      // Git text normalization erases this difference from its unstaged patch.
      assert.equal(after.unstagedSha256, before.unstagedSha256);
      assert.notEqual(after.id, before.id);
      const target = await provider.captureSnapshot(after.id);
      const diff = await provider.reviewDiff(baseline, target);
      assert.deepEqual(diff.changedFiles, ["source.txt"]);
      assert.match(diff.patch, /\+committed original\r\n/);
      await assert.rejects(lstat(marker), { code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("captures symlink replacements without reading through their parents", async () => {
    const root = await repository();
    const outside = await mkdtemp(path.join(os.tmpdir(), "anvil-revision-outside-"));
    try {
      await mkdir(path.join(root, "directory"));
      await writeFile(path.join(root, "directory", "secret.txt"), "tracked content\n");
      await writeFile(path.join(outside, "secret.txt"), "outside secret must not be read\n");
      git(root, "add", "directory"); git(root, "commit", "-m", "tracked directory");
      const provider = new GitRevisionProvider(root);
      const before = await provider.captureSnapshot((await provider.current()).id);
      await rm(path.join(root, "directory"), { recursive: true });
      await symlink(outside, path.join(root, "directory"));
      const after = await provider.captureSnapshot((await provider.current()).id);
      const diff = await provider.reviewDiff(before, after);
      assert.deepEqual(diff.changedFiles, ["directory", "directory/secret.txt"]);
      assert.match(diff.patch, /new file mode 120000/);
      assert.doesNotMatch(diff.patch, /outside secret must not be read/);
      assert.equal(after.files.some((file) => file.path === "directory/secret.txt"), false);
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });

  test("rejects tampered and unsafe snapshots rather than rendering substitute evidence", async () => {
    const root = await repository();
    try {
      const provider = new GitRevisionProvider(root);
      const baseline = await provider.captureSnapshot((await provider.current()).id);
      const tampered = structuredClone(baseline);
      tampered.files[0].contentBase64 = Buffer.from("substituted content").toString("base64");
      await assert.rejects(provider.reviewDiff(baseline, tampered), evidenceError);
      for (const relative of ["../escape", "/absolute", "directory/../escape", ".git/config"]) {
        const unsafe = structuredClone(baseline);
        unsafe.files[0].path = relative;
        const { revisionId, head, format, files } = unsafe;
        unsafe.checksum = sha256(JSON.stringify({ revisionId, head, format, files }));
        await assert.rejects(provider.reviewDiff(baseline, unsafe), evidenceError);
      }
      const duplicate = structuredClone(baseline);
      duplicate.files.push(duplicate.files[0]);
      const { revisionId, head, format, files } = duplicate;
      duplicate.checksum = sha256(JSON.stringify({ revisionId, head, format, files }));
      await assert.rejects(provider.reviewDiff(baseline, duplicate), evidenceError);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("blocks lossy non-UTF-8 text patches while preserving the raw snapshot", async () => {
    const root = await repository();
    try {
      const provider = new GitRevisionProvider(root);
      const baseline = await provider.captureSnapshot((await provider.current()).id);
      const raw = new Uint8Array([0x80, 0x81, 10]);
      await writeFile(path.join(root, "non-utf8.txt"), raw);
      const target = await provider.captureSnapshot((await provider.current()).id);
      assert.deepEqual(Buffer.from(target.files.find((file) => file.path === "non-utf8.txt")!.contentBase64, "base64"), Buffer.from(raw));
      await assert.rejects(provider.reviewDiff(baseline, target), (error: unknown) => evidenceError(error) && (error as Error).message.includes("non-UTF-8"));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
