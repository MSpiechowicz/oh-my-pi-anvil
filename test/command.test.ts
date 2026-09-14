import { describe, expect, test } from "./test-helpers.ts";
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
});
