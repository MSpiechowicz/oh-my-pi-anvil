import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { containedPath, assertSafeSymlink } from "./paths.ts";
import { sha256 } from "../util/hash.ts";
import type { ArtifactPointer } from "../workflow/types.ts";
import { AnvilError } from "../util/errors.ts";
import type { StateDatabase } from "./database.ts";

export class ArtifactStore {
  constructor(private readonly state: StateDatabase, private readonly runRoot: (runId: string) => string) {}
  async putText(runId: string, kind: string, relativePath: string, content: string, mediaType = "text/plain", attemptId?: string): Promise<ArtifactPointer> { return this.putBytes(runId, kind, relativePath, new TextEncoder().encode(content), mediaType, attemptId); }
  async putJson(runId: string, kind: string, relativePath: string, value: unknown, attemptId?: string): Promise<ArtifactPointer> { return this.putText(runId, kind, relativePath, JSON.stringify(value, null, 2), "application/json", attemptId); }
  async putBytes(runId: string, kind: string, relativePath: string, bytes: Uint8Array, mediaType: string, attemptId?: string): Promise<ArtifactPointer> {
    const root = this.runRoot(runId); const target = containedPath(root, relativePath); await mkdir(path.dirname(target), { recursive: true }); await assertSafeSymlink(root, target);
    const temp = `${target}.tmp-${crypto.randomUUID()}`; await writeFile(temp, bytes); await rename(temp, target);
    const pointer = { id: `art_${crypto.randomUUID()}`, path: relativePath, sha256: sha256(bytes) };
    this.state.db.run("INSERT OR REPLACE INTO artifacts(id, run_id, attempt_id, kind, relative_path, media_type, sha256, byte_length, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [pointer.id, runId, attemptId ?? null, kind, relativePath, mediaType, pointer.sha256, bytes.byteLength, new Date().toISOString()]);
    return pointer;
  }
  async readText(runId: string, pointer: ArtifactPointer): Promise<string> { const target = containedPath(this.runRoot(runId), pointer.path); const bytes = new Uint8Array(await Bun.file(target).arrayBuffer()); if (sha256(bytes) !== pointer.sha256) throw new AnvilError("ARTIFACT_CORRUPT", `Artifact hash mismatch: ${pointer.path}`); return new TextDecoder().decode(bytes); }
  async readJson<T>(runId: string, pointer: ArtifactPointer): Promise<T> { return JSON.parse(await this.readText(runId, pointer)) as T; }
}
