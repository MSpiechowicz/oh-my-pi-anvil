import { spawn } from "node:child_process";

export interface ProcessResult { status: "passed" | "failed" | "timed_out" | "error"; exitCode?: number; stdout: string; stderr: string; durationMs: number; }

export async function runProcess(command: string[], input: { cwd: string; env?: Record<string, string>; timeoutMs: number; signal?: AbortSignal }): Promise<ProcessResult> {
  const started = Date.now(); const stdoutChunks: Uint8Array[] = []; const stderrChunks: Uint8Array[] = []; let timedOut = false;
  try {
    const child = spawn(command[0], command.slice(1), { cwd: input.cwd, env: input.env ? { ...process.env, ...input.env } : process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk: Uint8Array) => stdoutChunks.push(new Uint8Array(chunk))); child.stderr.on("data", (chunk: Uint8Array) => stderrChunks.push(new Uint8Array(chunk)));
    const abort = () => child.kill("SIGKILL"); input.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, input.timeoutMs);
    const exitCode = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("close", (code) => resolve(code ?? 1)); });
    clearTimeout(timeout); input.signal?.removeEventListener("abort", abort);
    const stdout = new TextDecoder().decode(concat(stdoutChunks)); const stderr = new TextDecoder().decode(concat(stderrChunks));
    if (input.signal?.aborted) return { status: "error", exitCode, stdout, stderr, durationMs: Date.now() - started };
    if (timedOut) return { status: "timed_out", exitCode, stdout, stderr, durationMs: Date.now() - started };
    return { status: exitCode === 0 ? "passed" : "failed", exitCode, stdout, stderr, durationMs: Date.now() - started };
  } catch (error) { return { status: "error", stdout: "", stderr: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }; }
}

function concat(chunks: Uint8Array[]): Uint8Array { const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0); const output = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output; }
