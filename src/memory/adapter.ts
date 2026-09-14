import type { AgentRole, MemoryAdapter, RunRecord } from "../workflow/types.ts";
import { filterLessons } from "./retain.ts";

export interface OmpMemorySearchResult { items?: Array<{ id?: string; content: string }>; }
export interface OmpMemoryRuntime { search(query: string, options?: { limit?: number; signal?: AbortSignal }): Promise<OmpMemorySearchResult>; save(input: { content: string; context: string; source: string; importance: number }): Promise<unknown>; }
export class OptionalMemoryAdapter implements MemoryAdapter {
  constructor(private readonly runtime?: OmpMemoryRuntime, private readonly maxRetainedLessons = 3) {}

  async recall(_role: AgentRole, query: string, options: { limit: number; maxChars: number; signal?: AbortSignal }): Promise<Array<{ id?: string; content: string }>> {
    const limit = Number.isFinite(options.limit) ? Math.max(0, Math.floor(options.limit)) : 0;
    let remaining = Number.isFinite(options.maxChars) ? Math.max(0, Math.floor(options.maxChars)) : 0;
    if (!this.runtime || !limit || !remaining || options.signal?.aborted) return [];
    let result: OmpMemorySearchResult;
    try {
      result = await this.runtime.search(query, { limit, signal: options.signal });
    } catch {
      return [];
    }
    if (options.signal?.aborted || !Array.isArray(result?.items)) return [];
    const recalled: Array<{ id?: string; content: string }> = [];
    for (let index = 0; index < Math.min(result.items.length, limit) && remaining > 0; index++) {
      const item = result.items[index];
      if (!item || typeof item.content !== "string" || item.content.length > remaining || !item.content.trim()) continue;
      remaining -= item.content.length;
      recalled.push(typeof item.id === "string" ? { id: item.id, content: item.content } : { content: item.content });
    }
    return recalled;
  }

  async retain(lessons: Array<{ content: string; importance: number }>, run: RunRecord): Promise<void> {
    if (!this.runtime) return;
    for (const lesson of filterLessons(lessons, this.maxRetainedLessons)) {
      try {
        await this.runtime.save({ content: lesson.content, context: `Anvil successful run ${run.id}`, source: "omp-anvil", importance: lesson.importance });
      } catch {
        // Durable memory is advisory; one provider failure must not prevent sealing or other saves.
      }
    }
  }
}
