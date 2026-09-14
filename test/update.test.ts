import { describe, expect, test } from "./test-helpers.ts";
import { CommandRouter } from "../src/commands/router.ts";
import { renderUpdate } from "../src/ui/render.ts";
import { latestRelease } from "../src/update.ts";
describe("release updater metadata", () => {
  test("renders updated reports as the update message", () => {
    const output = renderUpdate({
      currentVersion: "0.1.10",
      latestVersion: "0.1.10",
      updateAvailable: false,
      releaseUrl: null,
      managed: true,
      updated: true,
      message: "Updated to 0.1.10 using OMP plugin upgrade. Restart OMP to load the updated extension.",
    });
    expect(output).toBe("Updated to 0.1.10 using OMP plugin upgrade. Restart OMP to load the updated extension.");
  });
  test("renders current reports as one plain status line", () => {
    const output = renderUpdate({
      currentVersion: "0.1.11",
      latestVersion: "0.1.11",
      updateAvailable: false,
      releaseUrl: "https://github.com/MSpiechowicz/oh-my-pi-anvil/releases/tag/v0.1.11",
      managed: true,
    });
    expect(output).toBe("Anvil 0.1.11: No newer release available.");
  });
  test("accepts only published stable v-tags", async () => {
    const release = await latestRelease(async () => new Response(JSON.stringify({ draft: false, prerelease: false, tag_name: "v1.2.3" }), { status: 200 })); expect(release).toEqual({ version: "1.2.3", tag: "v1.2.3", url: "https://github.com/MSpiechowicz/oh-my-pi-anvil/releases/tag/v1.2.3" });
  });

  test("rejects prerelease metadata", async () => {
    expect(latestRelease(async () => new Response(JSON.stringify({ draft: false, prerelease: true, tag_name: "v1.2.3-rc.1" }), { status: 200 }))).rejects.toThrow("published stable release");
  });

  test("routes Anvil update syntax without opening workflow state", async () => {
    const router = new CommandRouter(async () => { throw new Error("workflow state should not open for update syntax errors"); });
    const response = await router.handleAdmin("update", { cwd: "/tmp" });
    expect(response).toContain("Usage: /anvil update check|install");
  });
});
