import assert from "node:assert/strict";
import { Ajv } from "ajv";
import { describe, expect, test } from "./test-helpers.ts";
import {
  IMPLEMENTATION_OUTPUT_SCHEMA,
  PLAN_OUTPUT_SCHEMA,
  REVIEW_OUTPUT_SCHEMA,
  SECURITY_OUTPUT_SCHEMA,
} from "../src/schemas/outputs.ts";
import { requireImplementation, requirePlan, requireReview, requireSecurity } from "../src/schemas/validate.ts";
import { AnvilError } from "../src/util/errors.ts";
import type { ImplementationOutput, PlanOutput, ReviewOutput, SecurityOutput } from "../src/workflow/types.ts";

const plan: PlanOutput = {
  version: 1,
  summary: "Require tenant authorization before reading records",
  assumptions: ["Requests carry an authenticated tenant ID"],
  steps: [
    {
      id: "authorize",
      title: "Scope record lookup",
      objective: "Reject records belonging to another tenant",
      dependsOn: [],
      fileHints: ["src/records.ts"],
      symbolHints: ["readRecord"],
      acceptanceCriteria: ["Cross-tenant reads are denied"],
      risk: "high",
      securitySurfaces: ["Tenant authorization"],
    },
    {
      id: "regression",
      title: "Cover tenant isolation",
      objective: "Protect cross-tenant denial behavior",
      dependsOn: ["authorize"],
      fileHints: ["test/records.test.ts"],
      symbolHints: [],
      acceptanceCriteria: ["A cross-tenant request cannot return record contents"],
      risk: "low",
      securitySurfaces: [],
    },
  ],
  globalAcceptanceCriteria: ["Only the owning tenant can read a record"],
  requiredChecks: [{ id: "tenant-isolation", reason: "Exercise cross-tenant requests" }],
  risks: [{ category: "authorization", description: "Unscoped legacy lookups", mitigation: "Audit lookup callers" }],
  replanTriggers: ["The request has no trusted tenant identity"],
};

const implementation: ImplementationOutput = {
  version: 1,
  status: "completed",
  summary: "Scoped record reads to the authenticated tenant",
  claimedChangedFiles: ["src/records.ts", "test/records.test.ts"],
  addressedFindingIds: ["tenant-read"],
  remainingConcerns: ["Legacy callers need a separate audit"],
  durableLessons: [{ content: "Scope record lookups before returning data", importance: 0.8 }],
  verification: [{
    criterion: "Cross-tenant requests cannot return another tenant's data",
    status: "passed",
    evidence: "Tenant B received HTTP 403 for tenant A's record; no record fields were returned",
    artifactPaths: ["verification/tenant-response.json"],
  }],
};

const security: SecurityOutput = {
  version: 1,
  verdict: "findings",
  scope: { revisionId: "revision-1", reviewedAreas: ["Record lookup authorization"] },
  findings: [{
    severity: "high",
    category: "authorization",
    title: "Record lookup lacks tenant scope",
    file: "src/records.ts",
    lineStart: 12,
    lineEnd: 16,
    symbol: "readRecord",
    description: "Lookup uses only the record ID",
    evidence: "A request from tenant B returned tenant A's record",
    exploitOrImpact: "Cross-tenant data disclosure",
    fixRequirement: "Constrain lookup by the authenticated tenant ID",
    confidence: "high",
  }],
  residualRisks: ["Legacy endpoints were outside the reviewed scope"],
};

const review: ReviewOutput = {
  version: 1,
  verdict: "findings",
  acceptance: [{
    criterion: "Only the owning tenant can read a record",
    status: "not_satisfied",
    evidence: "The legacy endpoint still uses an unscoped lookup",
  }],
  findings: [{
    severity: "blocking",
    category: "correctness",
    title: "Legacy lookup bypasses tenant scope",
    file: "src/legacy-records.ts",
    lineStart: 20,
    lineEnd: 23,
    symbol: "legacyRead",
    description: "The legacy route has not migrated to the scoped lookup",
    evidence: "legacyRead calls the unscoped repository method",
    fixRequirement: "Use the scoped lookup in the legacy route",
  }],
  notes: ["The primary endpoint enforces tenant isolation"],
};

interface OutputContract {
  role: string;
  title: string;
  fixture: PlanOutput | ImplementationOutput | SecurityOutput | ReviewOutput;
  host: (value: unknown) => boolean;
  local: (value: unknown) => unknown;
}

// The host independently compiles the JSON schemas it receives, without data repair.
const ajv = new Ajv({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
const plannerContract: OutputContract = {
  role: "Architect", title: "PlanOutput", fixture: plan,
  host: ajv.compile(PLAN_OUTPUT_SCHEMA), local: requirePlan,
};
const smithContract: OutputContract = {
  role: "Smith", title: "ImplementationOutput", fixture: implementation,
  host: ajv.compile(IMPLEMENTATION_OUTPUT_SCHEMA), local: requireImplementation,
};
const sentinelContract: OutputContract = {
  role: "Sentinel", title: "SecurityOutput", fixture: security,
  host: ajv.compile(SECURITY_OUTPUT_SCHEMA), local: requireSecurity,
};
const reviewContract: OutputContract = {
  role: "Inquisitor", title: "ReviewOutput", fixture: review,
  host: ajv.compile(REVIEW_OUTPUT_SCHEMA), local: requireReview,
};

function accepts(contract: OutputContract, value: unknown): void {
  const hostInput = structuredClone(value);
  const localInput = structuredClone(value);
  expect(contract.host(hostInput)).toBe(true);
  expect(contract.local(localInput)).toEqual(value);
  expect(hostInput).toEqual(value);
  expect(localInput).toEqual(value);
}

function rejectsLocally(contract: OutputContract, value: unknown, field?: string): void {
  const input = structuredClone(value);
  assert.throws(() => contract.local(input), (error: unknown) => {
    assert.ok(error instanceof AnvilError);
    expect(error.code).toBe("SCHEMA_INVALID");
    expect(error.message).toContain(contract.role);
    if (field) expect(error.message).toContain(field);
    return true;
  });
  expect(input).toEqual(value);
}

function rejects(contract: OutputContract, value: unknown, field?: string): void {
  const input = structuredClone(value);
  expect(contract.host(input)).toBe(false);
  expect(input).toEqual(value);
  rejectsLocally(contract, value, field);
}

for (const contract of [plannerContract, smithContract, sentinelContract, reviewContract]) {
  describe(`${contract.role} shared output contract`, () => {
    test("accepts a complete nested report without changing its data", () => {
      accepts(contract, contract.fixture);
    });

    test("rejects arbitrary JSON and the former name/version descriptor as output", () => {
      rejects(contract, null);
      rejects(contract, { unrelated: [true, "not a report"] });
      rejects(contract, { name: contract.title, version: 1 });
    });

    test("rejects unsupported versions and unrecognized report fields", () => {
      rejects(contract, { ...contract.fixture, version: 2 }, "version");
      rejects(contract, { ...contract.fixture, unrecognized: true }, "unrecognized");
    });
  });
}

describe("Architect nested plan contract", () => {
  test("requires nested check fields and correctly typed risk details", () => {
    rejects(plannerContract, { ...plan, requiredChecks: [{ id: "tenant-isolation" }] }, "reason");
    rejects(plannerContract, { ...plan, risks: [{ ...plan.risks[0], mitigation: ["Audit callers"] }] }, "mitigation");
  });

  test("rejects malformed dependency arrays and invalid step risk", () => {
    rejects(plannerContract, { ...plan, steps: [{ ...plan.steps[0], dependsOn: "authorize" }] }, "dependsOn");
    rejects(plannerContract, { ...plan, steps: [{ ...plan.steps[0], risk: "critical" }] }, "risk");
  });

  test("rejects unknown nested fields and empty step acceptance criteria", () => {
    rejects(plannerContract, { ...plan, steps: [{ ...plan.steps[0], optional: true }] }, "optional");
    rejects(plannerContract, { ...plan, steps: [{ ...plan.steps[0], acceptanceCriteria: [] }] }, "acceptanceCriteria");
  });

  test("locally rejects duplicate step IDs and dependencies absent from the plan", () => {
    const duplicate = { ...plan, steps: [plan.steps[0], { ...plan.steps[1], id: plan.steps[0].id }] };
    const unknownDependency = { ...plan, steps: [{ ...plan.steps[0], dependsOn: ["missing-step"] }] };
    // These cross-step relationships remain local checks, not JSON Schema constraints.
    expect(plannerContract.host(duplicate)).toBe(true);
    expect(plannerContract.host(unknownDependency)).toBe(true);
    rejectsLocally(plannerContract, duplicate);
    rejectsLocally(plannerContract, unknownDependency);
  });
});

describe("Smith implementation contract", () => {
  test("rejects a report missing claimedChangedFiles at both acceptance boundaries", () => {
    const { claimedChangedFiles: _claimedChangedFiles, ...missingFiles } = implementation;
    rejects(smithContract, missingFiles, "claimedChangedFiles");
  });

  test("rejects invalid status and malformed string-array contents", () => {
    rejects(smithContract, { ...implementation, status: "pass" }, "status");
    rejects(smithContract, { ...implementation, addressedFindingIds: [42] }, "addressedFindingIds");
  });

  test("does not coerce lesson importance or discard unknown lesson fields", () => {
    rejects(smithContract, { ...implementation, durableLessons: [{ content: "Scope reads", importance: "0.8" }] }, "importance");
    rejects(smithContract, {
      ...implementation, durableLessons: [{ content: "Scope reads", importance: 0.8, source: "session" }],
    }, "source");
  });

  test("accepts omitted optional lessons but not null lessons", () => {
    const { durableLessons: _durableLessons, ...withoutLessons } = implementation;
    accepts(smithContract, withoutLessons);
    accepts(smithContract, { ...withoutLessons, status: "blocked" });
    rejects(smithContract, { ...withoutLessons, durableLessons: null }, "durableLessons");
  });

  test("requires explicit verification outcomes and observations without coercion", () => {
    const verification = implementation.verification![0];
    rejects(smithContract, { ...implementation, verification: [{ ...verification, status: true }] }, "status");
    rejects(smithContract, { ...implementation, verification: [{ ...verification, evidence: "" }] }, "evidence");
    accepts(smithContract, { ...implementation, verification: [{
      criterion: verification.criterion, status: "not_run", evidence: "No authenticated fixture was available",
    }] });
  });

  test("requires a nonempty reason only when replanning is requested", () => {
    const replan = { ...implementation, status: "needs_replan" };
    rejects(smithContract, replan, "replanReason");
    rejects(smithContract, { ...replan, replanReason: "" }, "replanReason");
    accepts(smithContract, { ...replan, replanReason: "The endpoint has no trusted tenant identity" });
  });
});

describe("Sentinel security contract", () => {
  test("does not coerce declarations that control security pass reuse", () => {
    rejects(sentinelContract, { ...security, verificationIndependent: "true" }, "verificationIndependent");
    rejects(sentinelContract, { ...security, liveValidation: "false" }, "liveValidation");
    accepts(sentinelContract, { ...security, verificationIndependent: false, liveValidation: true });
  });

  test("requires the full scope and rejects malformed reviewed areas", () => {
    rejects(sentinelContract, { ...security, scope: { reviewedAreas: [] } }, "revisionId");
    rejects(sentinelContract, { ...security, scope: { ...security.scope, reviewedAreas: [false] } }, "reviewedAreas");
  });

  test("requires finding evidence and validates severity and confidence", () => {
    const { evidence: _evidence, ...withoutEvidence } = security.findings[0];
    rejects(sentinelContract, { ...security, findings: [withoutEvidence] }, "evidence");
    rejects(sentinelContract, { ...security, findings: [{ ...security.findings[0], severity: "blocking" }] }, "severity");
    rejects(sentinelContract, { ...security, findings: [{ ...security.findings[0], confidence: "certain" }] }, "confidence");
  });

  test("allows omitted finding locations but rejects wrongly typed optional locations", () => {
    const finding = structuredClone(security.findings[0]);
    delete finding.file;
    delete finding.lineStart;
    delete finding.lineEnd;
    delete finding.symbol;
    accepts(sentinelContract, { ...security, findings: [finding] });
    rejects(sentinelContract, { ...security, findings: [{ ...finding, lineStart: "12" }] }, "lineStart");
  });
});

describe("Inquisitor review contract", () => {
  test("requires acceptance evidence and validates acceptance status", () => {
    rejects(reviewContract, { ...review, acceptance: [{ criterion: "Tenant isolation", status: "satisfied" }] }, "evidence");
    rejects(reviewContract, { ...review, acceptance: [{ ...review.acceptance[0], status: "pass" }] }, "status");
  });

  test("rejects security-only finding severities and unknown acceptance fields", () => {
    rejects(reviewContract, { ...review, findings: [{ ...review.findings[0], severity: "critical" }] }, "severity");
    rejects(reviewContract, { ...review, acceptance: [{ ...review.acceptance[0], approved: true }] }, "approved");
  });

  test("allows omitted finding locations but rejects wrongly typed optional symbols", () => {
    const finding = structuredClone(review.findings[0]);
    delete finding.file;
    delete finding.lineStart;
    delete finding.lineEnd;
    delete finding.symbol;
    accepts(reviewContract, { ...review, findings: [finding] });
    rejects(reviewContract, { ...review, findings: [{ ...finding, symbol: 42 }] }, "symbol");
  });
});

for (const contract of [sentinelContract, reviewContract]) {
  describe(`${contract.role} gate verdict conditions`, () => {
    test("accepts an empty pass but rejects findings verdicts without findings", () => {
      accepts(contract, { ...contract.fixture, verdict: "pass", findings: [] });
      rejects(contract, { ...contract.fixture, verdict: "findings", findings: [] }, "findings");
      rejects(contract, { ...contract.fixture, verdict: "completed" }, "verdict");
    });

    test("requires a nonempty blocked reason", () => {
      const blocked = { ...contract.fixture, verdict: "blocked", findings: [] };
      rejects(contract, blocked, "blockedReason");
      rejects(contract, { ...blocked, blockedReason: "" }, "blockedReason");
      accepts(contract, { ...blocked, blockedReason: "The target revision is unavailable" });
    });
  });
}
