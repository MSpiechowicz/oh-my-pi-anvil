import type { ArtifactStore } from "../state/artifact-store.ts";
import { runProcess } from "./process.ts";
import type { CheckDefinition, CheckResult, CheckRunner as CheckRunnerContract } from "../workflow/types.ts";
import { boundedText } from "../util/json.ts";

export class DeterministicCheckRunner implements CheckRunnerContract {
  constructor(private readonly artifacts?: ArtifactStore) {}
  async run(check: CheckDefinition, input: { cwd: string; signal?: AbortSignal; runId?: string; epoch?: number }): Promise<CheckResult> {
    const result = await runProcess(check.command, { cwd: check.cwd ?? input.cwd, env: check.env, timeoutMs: check.timeoutMs, signal: input.signal });
    const stdout = input.runId && this.artifacts ? await this.artifacts.putText(input.runId, "check-stdout", `logs/check-${check.id}-${input.epoch ?? 0}.stdout`, result.stdout) : undefined;
    const stderr = input.runId && this.artifacts ? await this.artifacts.putText(input.runId, "check-stderr", `logs/check-${check.id}-${input.epoch ?? 0}.stderr`, result.stderr) : undefined;
    const highlights = (result.stderr || result.stdout).split(/\r?\n/).filter((line) => /error|fail|assert|✗/i.test(line)).slice(0, 8);
    return { id: check.id, status: result.status, exitCode: result.exitCode, durationMs: result.durationMs, stdoutArtifact: stdout, stderrArtifact: stderr, summary: result.status === "passed" ? `${check.id} passed` : boundedText(highlights.join(" | ") || `${check.id} exited ${result.exitCode ?? "with an error"}`, 800) };
  }
}
