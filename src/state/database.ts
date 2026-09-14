import { Database } from "./sqlite.ts";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { applyMigrations } from "./migrations.ts";

export class StateDatabase {
  readonly db: Database;
  private constructor(readonly filePath: string, db: Database) { this.db = db; }
  static async open(root: string): Promise<StateDatabase> {
    await mkdir(root, { recursive: true });
    const database = new Database(path.join(root, "anvil.db"), { create: true, readwrite: true });
    applyMigrations(database);
    return new StateDatabase(path.join(root, "anvil.db"), database);
  }
  close(): void { this.db.close(); }
}
