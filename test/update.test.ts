import { describe, expect, test } from "bun:test";
import { CommandRouter } from "../src/commands/router.ts";
import { latestRelease } from "../src/update.ts";
describe("release updater metadata", () => {
  test("accepts only published stable v-tags", async () => {
    const release = await latestRelease(async () => new Response(JSON.stringify({ draft: false, prerelease: false, tag_name: "v1.2.3" }), { status: 200 })); expect(release).toEqual({ version: "1.2.3", tag: "v1.2.3", url: "https://github.com/MSpiechowicz/oh-my-pi-anvil/releases/tag/v1.2.3" });
  });

  test("rejects prerelease metadata", async () => {
    expect(latestRelease(async () => new Response(JSON.stringify({ draft: false, prerelease: true, tag_name: "v1.2.3-rc.1" }), { status: 200 }))).rejects.toThrow("published stable release");
  });

  test("routes update syntax without opening workflow state", async () => {
    const router = new CommandRouter(async () => { throw new Error("workflow state should not open for update syntax errors"); }); const response = await router.handle("update", { cwd: "/tmp" }); expect(response).toContain("Usage: /orchestrate update check|install");
  });
});
