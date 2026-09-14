import type { StateDatabase } from "./database.ts";

export interface EventInput { runId: string; type: string; actor: string; stateBefore?: string; stateAfter?: string; revisionId?: string; payload?: unknown; }
export class EventStore {
  constructor(private readonly state: StateDatabase) {}
  append(event: EventInput): void { this.state.db.run("INSERT INTO events(run_id, timestamp, type, actor, state_before, state_after, revision_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [event.runId, new Date().toISOString(), event.type, event.actor, event.stateBefore ?? null, event.stateAfter ?? null, event.revisionId ?? null, JSON.stringify(event.payload ?? {})]); }
  list(runId: string): Array<Record<string, unknown>> { return this.state.db.query<Record<string, unknown>>("SELECT * FROM events WHERE run_id = ? ORDER BY seq").all(runId); }
}
