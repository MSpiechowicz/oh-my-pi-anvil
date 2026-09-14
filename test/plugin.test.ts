import { describe, expect, test } from "./test-helpers.ts";

describe("marketplace extension discovery", () => {
  test("declares the root extension and build output", async () => {
    const repositoryRoot = new URL("..", import.meta.url);
    const packageManifest = JSON.parse(await Deno.readTextFile(new URL("package.json", repositoryRoot))) as {
      files?: unknown[];
      omp?: { extensions?: unknown };
    };
    const denoManifest = JSON.parse(await Deno.readTextFile(new URL("deno.json", repositoryRoot))) as {
      tasks?: { build?: unknown };
    };

    expect(packageManifest.files?.includes("extension.js")).toBe(true);
    expect(packageManifest.omp?.extensions).toEqual(["./extension.js"]);
    expect(denoManifest.tasks?.build).toContain("deno bundle src/extension.ts -o extension.js");
  });
});
