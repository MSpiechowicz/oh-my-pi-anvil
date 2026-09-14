import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { containedPath } from "../src/state/paths.ts";

describe("artifact path safety", () => {
  test("rejects traversal and absolute paths", async () => {
    const root = await mkdtemp("/tmp/anvil-artifact-"); expect(() => containedPath(root, "../escape.json")).toThrow(); expect(() => containedPath(root, "/tmp/escape.json")).toThrow(); await rm(root, { recursive: true, force: true });
  });
});
