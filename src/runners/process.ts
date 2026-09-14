export interface ProcessResult { status: "passed" | "failed" | "timed_out" | "error"; exitCode?: number; stdout: string; stderr: string; durationMs: number; }

export async function runProcess(command: string[], input: { cwd: string; env?: Record<string, string>; timeoutMs: number; signal?: AbortSignal }): Promise<ProcessResult> {
  const started = Date.now();
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    child = Bun.spawn({ cmd: command, cwd: input.cwd, env: input.env, stdout: "pipe", stderr: "pipe" });
    const abort = () => child?.kill(15);
    input.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => child?.kill(15), input.timeoutMs);
    const exitCode = await child.exited;
    clearTimeout(timeout); input.signal?.removeEventListener("abort", abort);
    const stdout = await new Response(child.stdout).text(); const stderr = await new Response(child.stderr).text();
    if (input.signal?.aborted) return { status: "error", exitCode, stdout, stderr, durationMs: Date.now() - started };
    if (Date.now() - started >= input.timeoutMs && exitCode !== 0) return { status: "timed_out", exitCode, stdout, stderr, durationMs: Date.now() - started };
    return { status: exitCode === 0 ? "passed" : "failed", exitCode, stdout, stderr, durationMs: Date.now() - started };
  } catch (error) { return { status: "error", stdout: "", stderr: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }; }
}
