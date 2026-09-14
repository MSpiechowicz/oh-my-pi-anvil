import { mkdir, open, realpath, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
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
    const root = this.runRoot(runId); const target = containedPath(root, relativePath); await assertSafeSymlink(root, target); await mkdir(path.dirname(target), { recursive: true }); await assertSafeSymlink(root, target);
    const temp = `${target}.tmp-${crypto.randomUUID()}`; await writeFile(temp, bytes); await rename(temp, target);
    const pointer = { id: `art_${crypto.randomUUID()}`, path: relativePath, sha256: sha256(bytes) };
    this.state.db.run("INSERT OR REPLACE INTO artifacts(id, run_id, attempt_id, kind, relative_path, media_type, sha256, byte_length, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [pointer.id, runId, attemptId ?? null, kind, relativePath, mediaType, pointer.sha256, bytes.byteLength, new Date().toISOString()]);
    return pointer;
  }
  async readBytes(runId: string, pointer: ArtifactPointer): Promise<Uint8Array> { const bytes = await this.safeBytes(runId, pointer.path); if (sha256(bytes) !== pointer.sha256) throw new AnvilError("ARTIFACT_CORRUPT", `Artifact hash mismatch: ${pointer.path}`); return bytes; }
  async readText(runId: string, pointer: ArtifactPointer): Promise<string> { return new TextDecoder().decode(await this.readBytes(runId, pointer)); }
  async readJson<T>(runId: string, pointer: ArtifactPointer): Promise<T> { return JSON.parse(await this.readText(runId, pointer)) as T; }
  readable(runId: string, pointer: ArtifactPointer): ArtifactPointer { return { ...pointer, path: containedPath(this.runRoot(runId), pointer.path) }; }

  async capture(runId: string, sourcePath: string, attemptId: string, index: number): Promise<ArtifactPointer> {
    try {
      const bytes = await this.safeBytes(runId, sourcePath);
      return await this.putBytes(runId, "implementation-verification-file", `artifacts/implementation/${attemptId}/verification-${index}-${crypto.randomUUID()}${path.extname(sourcePath)}`, bytes, "application/octet-stream", attemptId);
    } catch (error) {
      throw new AnvilError("ARTIFACT_CORRUPT", `Cannot capture Smith verification artifact ${JSON.stringify(sourcePath)}. Supply an existing regular file relative to this run's artifact root, without symlinks or path escapes. ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  private async safeBytes(runId: string, relativePath: string): Promise<Uint8Array> {
    const root = path.resolve(this.runRoot(runId));
    const target = containedPath(root, relativePath);
    await assertSafeSymlink(root, target);
    const canonicalRoot = await realpath(root);
    const canonicalTarget = await realpath(target);
    containedPath(canonicalRoot, path.relative(canonicalRoot, canonicalTarget));
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await file.stat()).isFile()) throw new AnvilError("ARTIFACT_CORRUPT", `Artifact is not a regular file: ${relativePath}`);
      return await file.readFile();
    } finally { await file.close(); }
  }
}
