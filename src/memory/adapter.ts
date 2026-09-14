import type { AgentRole, MemoryAdapter, RunRecord } from "../workflow/types.ts";

export interface OmpMemoryRuntime { search(query: string, options?: { limit?: number; signal?: AbortSignal }): Promise<{ items?: Array<{ id?: string; content: string }> }>; save(input: { content: string; context: string; source: string; importance: number }): Promise<unknown>; }
export class OptionalMemoryAdapter implements MemoryAdapter {
  constructor(private readonly runtime?: OmpMemoryRuntime) {}
  async recall(_role: AgentRole, query: string, options: { limit: number; maxChars: number; signal?: AbortSignal }): Promise<Array<{ id?: string; content: string }>> { if (!this.runtime) return []; try { const result = await this.runtime.search(query, { limit: options.limit, signal: options.signal }); let remaining = options.maxChars; return (result.items ?? []).filter((item) => { if (remaining <= 0) return false; remaining -= item.content.length; return remaining >= 0; }); } catch { return []; } }
  async retain(lessons: Array<{ content: string; importance: number }>, run: RunRecord): Promise<void> { if (!this.runtime) return; for (const lesson of lessons.slice(0, 3)) { if (!lesson.content.trim() || lesson.content.length > 2000) continue; if (/api[_-]?key|secret|password|token/i.test(lesson.content)) continue; await this.runtime.save({ content: lesson.content, context: `Anvil successful run ${run.id}`, source: "omp-anvil", importance: lesson.importance }); } }
}
