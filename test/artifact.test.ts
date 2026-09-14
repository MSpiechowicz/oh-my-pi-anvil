import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "./test-helpers.ts";
import { assertSafeSymlink, containedPath } from "../src/state/paths.ts";

describe("artifact path safety", () => {
  test("rejects traversal and absolute paths", async () => {
    const root = await mkdtemp("/tmp/anvil-artifact-"); expect(() => containedPath(root, "../escape.json")).toThrow(); expect(() => containedPath(root, "/tmp/escape.json")).toThrow(); await rm(root, { recursive: true, force: true });
  });
  test("rejects symlink ancestors even when the target file does not exist", async () => {
    const root = await mkdtemp("/tmp/anvil-artifact-symlink-");
    try {
      await mkdir(path.join(root, "run")); await mkdir(path.join(root, "outside"));
      await writeFile(path.join(root, "outside", "existing.txt"), "outside");
      await symlink(path.join(root, "outside"), path.join(root, "run", "linked"));
      await expect(assertSafeSymlink(path.join(root, "run"), path.join(root, "run", "linked", "new-directory", "proof.png"))).rejects.toThrow();
      await expect(assertSafeSymlink(path.join(root, "run"), path.join(root, "run", "linked", "existing.txt"))).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
