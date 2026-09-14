import { DatabaseSync } from "node:sqlite";

type SqlParams = unknown[] | Record<string, unknown>;
interface PreparedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

function prepare(database: DatabaseSync, sql: string): PreparedStatement { return database.prepare(sql) as unknown as PreparedStatement; }
function positional(params?: SqlParams): unknown[] { if (!params) return []; if (Array.isArray(params)) return params; throw new TypeError("Named SQLite parameters are not supported by this adapter"); }

export class Database {
  private readonly database: DatabaseSync;
  constructor(filename: string, _options?: { create?: boolean; readwrite?: boolean; strict?: boolean }) { this.database = new DatabaseSync(filename); }
  exec(sql: string): void { this.database.exec(sql); }
  run(sql: string, params?: SqlParams): { changes: number; lastInsertRowid: number } { const result = prepare(this.database, sql).run(...positional(params)); return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) }; }
  query<T = Record<string, unknown>>(sql: string): { get(...params: unknown[]): T | null; all(...params: unknown[]): T[]; run(...params: unknown[]): { changes: number; lastInsertRowid: number } } {
    return {
      get: (...params) => prepare(this.database, sql).get(...params) as T | null,
      all: (...params) => prepare(this.database, sql).all(...params) as T[],
      run: (...params) => { const result = prepare(this.database, sql).run(...params); return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) }; },
    };
  }
  close(): void { this.database.close(); }
}
