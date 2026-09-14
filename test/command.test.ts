import { describe, expect, test } from "./test-helpers.ts";
import { CommandRouter } from "../src/commands/router.ts";
import anvilExtension from "../src/extension.ts";

describe("OMP command registration", () => {
  test("registers forge as the primary command and orchestrate as its compatibility alias", () => {
    const registrations: string[] = [];
    anvilExtension({
      registerCommand(name) {
        registrations.push(name);
      },
    });

    expect(registrations).toEqual(["forge", "orchestrate"]);
  });

  test("lists forge init in router help", async () => {
    const router = new CommandRouter(async () => {
      throw new Error("help should not initialize workflow state");
    });
    const help = await router.handle("help", { cwd: "/tmp" });
    expect(help).toContain("/forge init");
  });
});
