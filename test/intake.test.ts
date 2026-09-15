import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./test-helpers.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { StaticRevisionProvider } from "../src/git/revision.ts";
import { clarifyObjective, type IntakeRecord, type IntakeResult, type IntakeUI } from "../src/intake/clarify.ts";
import type { AgentRunRequest, AgentRunResult } from "../src/workflow/types.ts";

const question = {
  id: "compatibility",
  question: "Must existing clients continue to work?",
  whyItMatters: "The repository exposes a public endpoint used by existing clients.",
  options: [
    { id: "preserve", label: "Preserve compatibility", consequences: "Retain the existing request shape." },
    { id: "replace", label: "Replace the endpoint", consequences: "Existing clients must migrate." },
  ],
  recommendedOptionId: "preserve",
  recommendationReason: "The existing API is public and has compatibility coverage.",
};

function brief(questions: typeof question[] = []) {
  return {
    version: 1,
    objective: "Update the endpoint while preserving existing clients.",
    nonGoals: ["No client migration"],
    constraints: ["Retain existing request shape"],
    acceptanceCriteria: ["Existing client requests remain valid"],
    decisions: ["Preserve compatibility"],
    assumptions: [],
    repoFindings: [{ path: "src/api.ts", finding: "The existing API has public clients." }],
    questions,
  };
}

type Reply = (request: AgentRunRequest, call: number) => Promise<AgentRunResult<unknown>> | AgentRunResult<unknown>;

async function fixture(reply?: Reply) {
  const root = await mkdtemp("/tmp/anvil-intake-");
  const config = structuredClone(DEFAULT_CONFIG);
  const revisions = new StaticRevisionProvider({ id: "rev", head: "head", stagedSha256: "", unstagedSha256: "", untracked: [] });
  const requests: AgentRunRequest[] = [];
  const deps = {
    config, revisions, cwd: root, runtimeRoot: path.join(root, ".anvil"),
    agents: {
      async run<T>(request: AgentRunRequest): Promise<AgentRunResult<T>> {
        requests.push(request);
        const result = reply ? await reply(request, requests.length) : {
          status: "completed" as const, agentName: request.agentName, structured: brief(), usage: { total: 10, requests: 1 },
        };
        return result as AgentRunResult<T>;
      },
    },
  };
  return {
    ...deps, deps, requests,
    async persisted(result: IntakeResult): Promise<IntakeRecord> {
      return JSON.parse(await readFile(path.join(deps.runtimeRoot, "intake", `${result.record!.id}.json`), "utf8"));
    },
    async close() { await rm(root, { recursive: true, force: true }); },
  };
}

function scriptedUI(choices: Array<string | number | undefined>, inputs: Array<string | undefined> = []) {
  const screens: Array<{ title: string; options: string[] }> = [];
  const ui: IntakeUI = {
    async select(title, options) {
      screens.push({ title, options });
      if (!choices.length) throw new Error("Unexpected additional UI question");
      const choice = choices.shift();
      return typeof choice === "number" ? options[choice] : choice;
    },
    async input() {
      if (!inputs.length) throw new Error("Unexpected additional input request");
      return inputs.shift();
    },
  };
  return { ui, screens };
}

test("auto clear objective proceeds without UI and never adopts the proposed rewrite", async () => {
  const f = await fixture();
  try {
    const objective = "  Fix the endpoint regression without changing clients.  ";
    const result = await clarifyObjective({ objective, mode: "auto" }, f.deps);
    expect(result.status).toBe("ready");
    expect(result.record!.objective).toBe(objective);
    expect(result.record!.approved).toBe(false);
    expect((await f.persisted(result)).objective).toBe(objective);
    expect(result.record!.usage.total).toBe(10);
    expect(f.requests.length).toBe(1);
  } finally { await f.close(); }
});

test("off bypasses the model even with exhausted budgets and records the workspace revision", async () => {
  const f = await fixture(() => { throw new Error("Off must not call a model"); });
  try {
    f.config.budgets.maxTotalRequests = 0;
    const result = await clarifyObjective({ objective: "Exact objective", mode: "off" }, f.deps);
    expect(result.status).toBe("ready");
    const saved = await f.persisted(result);
    expect(saved.objective).toBe("Exact objective");
    expect(saved.revisionId).toBe("rev");
    expect(saved.usage.requests).toBe(0);
  } finally { await f.close(); }
});

test("noninteractive unresolved assessment returns needs_input, never a startable objective", async () => {
  const f = await fixture((request) => ({ status: "completed", agentName: request.agentName, structured: brief([question]), usage: { requests: 1 } }));
  try {
    const result = await clarifyObjective({ objective: "Modernize the endpoint", mode: "auto" }, f.deps);
    expect(result.status).toBe("needs_input");
    expect(result.message).toContain(question.question);
    expect(result.message).toContain(question.options[1].consequences);
    expect((await f.persisted(result)).brief!.questions).toEqual([question]);
    expect(f.requests.length).toBe(1);
  } finally { await f.close(); }
});

test("always requires explicit approval even when assessment has no questions", async () => {
  const f = await fixture();
  try {
    const result = await clarifyObjective({ objective: "Fix compatibility", mode: "always" }, f.deps);
    expect(result.status).toBe("needs_input");
    expect(result.record!.approved).toBe(false);
    expect(result.message).toContain("Explicit approval");
    expect((await f.persisted(result)).usage.requests).toBe(1);
  } finally { await f.close(); }
});

test("answered interview presents every brief section and only adopts the explicitly approved brief", async () => {
  const f = await fixture((request, call) => ({ status: "completed", agentName: request.agentName, structured: brief(call === 1 ? [question] : []), usage: { input: 4, output: 3, cacheRead: 2 } }));
  const ui = scriptedUI([0, "Approve brief"]);
  try {
    const result = await clarifyObjective({ objective: "Modernize endpoint", mode: "auto", ui: ui.ui }, f.deps);
    expect(result.status).toBe("ready");
    expect(result.record!.approved).toBe(true);
    const approval = ui.screens[1];
    for (const section of ["Objective", "Non-goals", "Constraints", "Acceptance criteria", "Decisions", "Assumptions", "Repository findings", "Explicit user answers", "Scope changes", "Unresolved questions"]) {
      expect(approval.title).toContain(section);
    }
    expect(approval.title).toContain(result.record!.objective);
    expect(result.record!.objective).toContain("Consequences accepted: Retain the existing request shape.");
    const saved = await f.persisted(result);
    expect(saved.approved).toBe(true);
    expect(saved.usage.total).toBe(14);
    expect(saved.usage.requests).toBe(2);
    expect(saved.usage.cacheRead).toBe(4);
  } finally { await f.close(); }
});

test("cancelling final approval preserves original objective and answered decisions", async () => {
  const f = await fixture((request, call) => ({ status: "completed", agentName: request.agentName, structured: brief(call === 1 ? [question] : []), usage: {} }));
  const ui = scriptedUI(["Custom answer", undefined], ["Support old clients for one release only."]);
  try {
    const result = await clarifyObjective({ objective: "Modernize endpoint", mode: "auto", ui: ui.ui }, f.deps);
    expect(result.status).toBe("cancelled");
    const saved = await f.persisted(result);
    expect(saved.objective).toBe("Modernize endpoint");
    expect(saved.answers[0].answer).toBe("Support old clients for one release only.");
    expect(saved.approved).toBe(false);
  } finally { await f.close(); }
});

test("round cap is a consent checkpoint and cancellation prevents another invocation", async () => {
  const f = await fixture((request) => ({ status: "completed", agentName: request.agentName, structured: brief([question]), usage: {} }));
  const ui = scriptedUI([0, "Cancel"]);
  try {
    f.config.clarification.maxRounds = 1;
    const result = await clarifyObjective({ objective: "Modernize endpoint", mode: "auto", ui: ui.ui }, f.deps);
    expect(result.status).toBe("cancelled");
    expect(ui.screens[1].options).toEqual(["Continue clarification", "Narrow scope", "Cancel"]);
    expect(f.requests.length).toBe(1);
    expect((await f.persisted(result)).answers[0].kind).toBe("option");
  } finally { await f.close(); }
});

test("explicit checkpoint continuation allows a further bounded round and still requires approval", async () => {
  const f = await fixture((request, call) => ({ status: "completed", agentName: request.agentName, structured: brief(call === 1 ? [question] : []), usage: {} }));
  const ui = scriptedUI([0, "Continue clarification", "Approve brief"]);
  try {
    f.config.clarification.maxRounds = 1;
    const result = await clarifyObjective({ objective: "Modernize endpoint", mode: "auto", ui: ui.ui }, f.deps);
    expect(result.status).toBe("ready");
    expect(result.record!.rounds).toBe(2);
    expect(result.record!.approved).toBe(true);
  } finally { await f.close(); }
});

test("explicit scope narrowing is retained in the exact brief the user approves", async () => {
  const f = await fixture((request, call) => ({ status: "completed", agentName: request.agentName, structured: brief(call === 1 ? [question] : []), usage: {} }));
  const scope = "Only the existing endpoint; exclude adding a second endpoint.";
  const ui = scriptedUI([0, "Narrow scope", "Approve brief"], [scope]);
  try {
    f.config.clarification.maxRounds = 1;
    const result = await clarifyObjective({ objective: "Modernize endpoint", mode: "auto", ui: ui.ui }, f.deps);
    expect(result.status).toBe("ready");
    expect(result.record!.objective).toContain(scope);
    expect((await f.persisted(result)).scopeChanges).toEqual([scope]);
  } finally { await f.close(); }
});

test("unknown decisions cannot disappear from model output and never expose an approval choice", async () => {
  const f = await fixture((request, call) => ({ status: "completed", agentName: request.agentName, structured: brief(call === 1 ? [question] : []), usage: {} }));
  const ui = scriptedUI(["I don't know", "Keep unresolved", "Cancel"]);
  try {
    const result = await clarifyObjective({ objective: "Modernize endpoint", mode: "auto", ui: ui.ui }, f.deps);
    expect(result.status).toBe("cancelled");
    expect(ui.screens.some((screen) => screen.options.includes("Approve brief"))).toBe(false);
    const saved = await f.persisted(result);
    expect(saved.brief!.questions).toEqual([question]);
    expect(saved.answers[0].kind).toBe("unresolved");
    expect(saved.approved).toBe(false);
  } finally { await f.close(); }
});

test("unknown can become only an explicitly scoped prototype, not a production default", async () => {
  const f = await fixture((request, call) => ({ status: "completed", agentName: request.agentName, structured: brief(call === 1 ? [question] : []), usage: {} }));
  const ui = scriptedUI(["I don't know", "Define a bounded prototype", "Approve brief"], ["Test old request fixtures locally; success means all parse without migration. Do not deploy."]);
  try {
    const result = await clarifyObjective({ objective: "Investigate compatibility", mode: "auto", ui: ui.ui }, f.deps);
    expect(result.status).toBe("ready");
    expect(result.record!.objective).toContain("production choice remains unapproved");
    expect(result.record!.objective).toContain("Do not deploy.");
    expect((await f.persisted(result)).answers[0].kind).toBe("prototype");
  } finally { await f.close(); }
});

test("blank custom answers cannot silently select the recommendation", async () => {
  const f = await fixture((request) => ({ status: "completed", agentName: request.agentName, structured: brief([question]), usage: {} }));
  const ui = scriptedUI(["Custom answer"], ["  "]);
  try {
    const result = await clarifyObjective({ objective: "Modernize endpoint", mode: "auto", ui: ui.ui }, f.deps);
    expect(result.status).toBe("needs_input");
    expect((await f.persisted(result)).answers).toEqual([]);
    expect(f.requests.length).toBe(1);
  } finally { await f.close(); }
});

test("read-only mutation rejects otherwise clear assessment while preserving incurred usage", async () => {
  const f = await fixture((request) => {
    f.revisions.set({ id: "mutated", head: "head", stagedSha256: "", unstagedSha256: "", untracked: ["src/api.ts"] });
    return { status: "completed", agentName: request.agentName, structured: brief(), usage: { total: 17, requests: 2 } };
  });
  try {
    const result = await clarifyObjective({ objective: "Fix compatibility", mode: "auto" }, f.deps);
    expect(result.status).toBe("needs_input");
    expect(result.message).toContain("Workspace revision changed");
    const saved = await f.persisted(result);
    expect(saved.usage.total).toBe(17);
    expect(saved.usage.requests).toBe(2);
    expect(saved.revisionId).toBe("rev");
  } finally { await f.close(); }
});

test("workspace mutation while awaiting user approval invalidates the entire interview", async () => {
  const f = await fixture();
  try {
    const result = await clarifyObjective({
      objective: "Fix compatibility", mode: "always",
      ui: {
        async select() {
          f.revisions.set({ id: "changed-during-interview", head: "head", stagedSha256: "", unstagedSha256: "", untracked: [] });
          return "Approve brief";
        },
        async input() { throw new Error("No input expected"); },
      },
    }, f.deps);
    expect(result.status).toBe("needs_input");
    expect(result.record!.approved).toBe(false);
    expect((await f.persisted(result)).message).toContain("Workspace revision changed");
  } finally { await f.close(); }
});

test("failed model output retains reported aggregate/cache usage and charges at least one request", async () => {
  const f = await fixture((request) => ({ status: "failed", agentName: request.agentName, usage: { total: 21, input: 4, output: 3, cacheRead: 14, requests: 0 }, error: { code: "PROVIDER_FAILED", message: "Provider disconnected" } }));
  try {
    const result = await clarifyObjective({ objective: "Fix compatibility", mode: "auto" }, f.deps);
    expect(result.status).toBe("needs_input");
    const saved = await f.persisted(result);
    expect(saved.usage.total).toBe(21);
    expect(saved.usage.cacheRead).toBe(14);
    expect(saved.usage.requests).toBe(1);
    expect(saved.message).toContain("Provider disconnected");
  } finally { await f.close(); }
});

test("provider exceptions persist a failure record with the attempted request charged", async () => {
  const f = await fixture(() => { throw new Error("Provider crashed"); });
  try {
    const result = await clarifyObjective({ objective: "Fix compatibility", mode: "auto" }, f.deps);
    expect(result.status).toBe("needs_input");
    const saved = await f.persisted(result);
    expect(saved.usage.requests).toBe(1);
    expect(saved.message).toContain("Provider crashed");
  } finally { await f.close(); }
});

test("aggregate reported token cap prevents a second model call even when input/output counts are smaller", async () => {
  const f = await fixture((request) => ({ status: "completed", agentName: request.agentName, structured: brief([question]), usage: { total: 20, input: 1, output: 1, cacheRead: 18 } }));
  const ui = scriptedUI([0]);
  try {
    f.config.budgets.maxTotalTokens = 20;
    const result = await clarifyObjective({ objective: "Modernize endpoint", mode: "auto", ui: ui.ui }, f.deps);
    expect(result.status).toBe("needs_input");
    expect(result.message).toContain("Total token budget exhausted");
    expect(f.requests.length).toBe(1);
    expect((await f.persisted(result)).usage.total).toBe(20);
  } finally { await f.close(); }
});

test("zero-reported model requests still consume the aggregate request cap", async () => {
  const f = await fixture((request) => ({ status: "completed", agentName: request.agentName, structured: brief([question]), usage: { requests: 0 } }));
  const ui = scriptedUI([0]);
  try {
    f.config.budgets.maxTotalRequests = 1;
    const result = await clarifyObjective({ objective: "Modernize endpoint", mode: "auto", ui: ui.ui }, f.deps);
    expect(result.status).toBe("needs_input");
    expect(result.message).toContain("Total request budget exhausted");
    expect(f.requests.length).toBe(1);
    expect((await f.persisted(result)).usage.requests).toBe(1);
  } finally { await f.close(); }
});

test("already exhausted aggregate budgets prevent the initial assessment", async () => {
  const f = await fixture(() => { throw new Error("No request budget remains"); });
  try {
    f.config.budgets.maxTotalRequests = 0;
    const result = await clarifyObjective({ objective: "Modernize endpoint", mode: "auto" }, f.deps);
    expect(result.status).toBe("needs_input");
    expect(f.requests.length).toBe(0);
    expect((await f.persisted(result)).usage.requests).toBe(0);
  } finally { await f.close(); }
});

test("strict assessment schema rejects unknown properties without losing usage", async () => {
  const f = await fixture((request) => ({ status: "completed", agentName: request.agentName, structured: { ...brief(), approved: true }, usage: { total: 7 } }));
  try {
    const result = await clarifyObjective({ objective: "Modernize endpoint", mode: "auto" }, f.deps);
    expect(result.status).toBe("needs_input");
    expect(result.message).toContain("Invalid intake output");
    expect((await f.persisted(result)).usage.total).toBe(7);
  } finally { await f.close(); }
});

test("oversized structured user answers stop rather than dropping decisions from later rounds", async () => {
  const f = await fixture((request) => ({ status: "completed", agentName: request.agentName, structured: brief([question]), usage: {} }));
  const ui = scriptedUI(["Custom answer"], ["x".repeat(1500)]);
  try {
    f.config.context.maxInlineChars = 1000;
    const result = await clarifyObjective({ objective: "Modernize endpoint", mode: "auto", ui: ui.ui }, f.deps);
    expect(result.status).toBe("needs_input");
    expect(result.message).toContain("No answers were silently dropped");
    expect(f.requests.length).toBe(1);
    expect((await f.persisted(result)).answers[0].answer).toBe("x".repeat(1500));
  } finally { await f.close(); }
});

test("hostile intake-directory symlinks cannot write records outside the runtime root", async () => {
  const f = await fixture();
  const outside = await mkdtemp("/tmp/anvil-intake-outside-");
  try {
    await mkdir(f.runtimeRoot, { recursive: true });
    await symlink(outside, path.join(f.runtimeRoot, "intake"));
    const result = await clarifyObjective({ objective: "Fix compatibility", mode: "off" }, f.deps);
    expect(result.status).toBe("needs_input");
    expect(result.message).toContain("Cannot persist intake record");
    expect(result.message).toContain("Symlink");
    expect(await readdir(outside)).toEqual([]);
    expect(result.record!.usage.requests).toBe(0);
  } finally {
    await f.close();
    await rm(outside, { recursive: true, force: true });
  }
});
