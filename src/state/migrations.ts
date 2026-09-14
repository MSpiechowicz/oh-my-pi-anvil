import type { Database } from "./sqlite.ts";

export function applyMigrations(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`);
  const applied = db.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version);
  if (applied.includes(1)) return;
  db.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, workflow_name TEXT NOT NULL, workflow_version INTEGER NOT NULL, config_hash TEXT NOT NULL,
      workspace_root TEXT NOT NULL, objective_path TEXT NOT NULL, plan_path TEXT, base_revision_id TEXT NOT NULL, current_revision_id TEXT NOT NULL,
      mutation_epoch INTEGER NOT NULL DEFAULT 0, current_state TEXT NOT NULL, status TEXT NOT NULL, active_attempt_id TEXT,
      max_total_tokens INTEGER, max_total_requests INTEGER, max_transitions INTEGER, max_wall_clock_ms INTEGER,
      used_tokens INTEGER NOT NULL DEFAULT 0, used_input_tokens INTEGER NOT NULL DEFAULT 0, used_output_tokens INTEGER NOT NULL DEFAULT 0,
      used_cache_read_tokens INTEGER NOT NULL DEFAULT 0, used_cache_write_tokens INTEGER NOT NULL DEFAULT 0, used_requests INTEGER NOT NULL DEFAULT 0,
      transition_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      blocked_reason TEXT, failure_code TEXT, failure_message TEXT, initial_head TEXT NOT NULL
    );
    CREATE TABLE attempts (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, state TEXT NOT NULL, role TEXT,
      agent_name TEXT, model_selector TEXT, input_artifact_id TEXT, output_artifact_id TEXT, base_revision_id TEXT NOT NULL, result_revision_id TEXT,
      status TEXT NOT NULL, verdict TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0, context_tokens INTEGER, context_window INTEGER, duration_ms INTEGER, started_at TEXT NOT NULL,
      ended_at TEXT, error_code TEXT, error_message TEXT, UNIQUE(run_id, sequence)
    );
    CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, timestamp TEXT NOT NULL,
      type TEXT NOT NULL, actor TEXT NOT NULL, state_before TEXT, state_after TEXT, revision_id TEXT, payload_json TEXT NOT NULL);
    CREATE INDEX idx_events_run_seq ON events(run_id, seq);
    CREATE TABLE artifacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
      kind TEXT NOT NULL, relative_path TEXT NOT NULL, media_type TEXT NOT NULL, sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(run_id, relative_path));
    CREATE TABLE findings (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, source_gate TEXT NOT NULL, fingerprint TEXT NOT NULL,
      severity TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, fix_requirement TEXT, file_path TEXT, line_start INTEGER,
      line_end INTEGER, status TEXT NOT NULL, first_seen_epoch INTEGER NOT NULL, last_seen_epoch INTEGER NOT NULL, times_seen INTEGER NOT NULL DEFAULT 1,
      reopen_count INTEGER NOT NULL DEFAULT 0, first_attempt_id TEXT NOT NULL, last_attempt_id TEXT NOT NULL, evidence_artifact_id TEXT, resolved_attempt_id TEXT,
      resolution_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(run_id, source_gate, fingerprint));
    CREATE TABLE gate_results (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, gate TEXT NOT NULL, revision_id TEXT NOT NULL,
      mutation_epoch INTEGER NOT NULL, config_hash TEXT NOT NULL, gate_policy_hash TEXT NOT NULL, verdict TEXT NOT NULL, attempt_id TEXT, artifact_id TEXT,
      started_at TEXT NOT NULL, ended_at TEXT NOT NULL, UNIQUE(run_id, gate, revision_id, config_hash, gate_policy_hash));
    INSERT INTO schema_migrations(version, applied_at) VALUES (1, '${new Date().toISOString()}');
  `);
}
