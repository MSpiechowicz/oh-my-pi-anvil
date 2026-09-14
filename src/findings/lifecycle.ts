import { findingFingerprint } from "./fingerprint.ts";
import type { FindingRepository } from "../state/repositories.ts";
import type { ArtifactPointer, AttemptRecord, GateName } from "../workflow/types.ts";

export interface IncomingFinding { severity: string; category: string; title: string; description: string; fixRequirement?: string; file?: string; lineStart?: number; lineEnd?: number; symbol?: string; evidenceArtifactId?: string; }
export class FindingLifecycle {
  constructor(private readonly findings: FindingRepository) {}
  upsert(runId: string, sourceGate: GateName, epoch: number, attempt: AttemptRecord, incoming: IncomingFinding): ReturnType<FindingRepository["upsert"]> { return this.findings.upsert({ runId, sourceGate, fingerprint: findingFingerprint({ sourceGate, category: incoming.category, file: incoming.file, symbol: incoming.symbol, title: incoming.title }), severity: incoming.severity, category: incoming.category, title: incoming.title, description: incoming.description, fixRequirement: incoming.fixRequirement, filePath: incoming.file, lineStart: incoming.lineStart, lineEnd: incoming.lineEnd, firstSeenEpoch: epoch, lastSeenEpoch: epoch, firstAttemptId: attempt.id, lastAttemptId: attempt.id, evidenceArtifactId: incoming.evidenceArtifactId }); }
  resolve(sourceGate: GateName, runId: string, attemptId: string): void { this.findings.resolveGate(runId, sourceGate, attemptId); }
}
