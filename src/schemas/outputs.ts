const STRING_ARRAY = { type: "array", items: { type: "string" } };
const NONEMPTY_STRING = { type: "string", minLength: 1 };
const NONEMPTY_STRING_ARRAY = { type: "array", items: { type: "string" }, minItems: 1 };
const GATE_VERDICT = { type: "string", enum: ["pass", "findings", "blocked"] };
const GATE_CONDITIONS = [
  {
    if: { properties: { verdict: { const: "findings" } }, required: ["verdict"] },
    then: { properties: { findings: { type: "array", minItems: 1 } }, required: ["findings"] },
  },
  {
    if: { properties: { verdict: { const: "blocked" } }, required: ["verdict"] },
    then: { properties: { blockedReason: NONEMPTY_STRING }, required: ["blockedReason"] },
  },
];

export const PLAN_OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "PlanOutput",
  type: "object",
  additionalProperties: false,
  required: ["version", "summary", "assumptions", "steps", "globalAcceptanceCriteria", "requiredChecks", "risks", "replanTriggers"],
  properties: {
    version: { type: "number", const: 1 },
    summary: NONEMPTY_STRING,
    assumptions: STRING_ARRAY,
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "objective", "dependsOn", "fileHints", "symbolHints", "acceptanceCriteria", "risk", "securitySurfaces"],
        properties: {
          id: NONEMPTY_STRING,
          title: { type: "string" },
          objective: NONEMPTY_STRING,
          dependsOn: STRING_ARRAY,
          fileHints: STRING_ARRAY,
          symbolHints: STRING_ARRAY,
          acceptanceCriteria: NONEMPTY_STRING_ARRAY,
          risk: { type: "string", enum: ["low", "medium", "high"] },
          securitySurfaces: STRING_ARRAY,
        },
      },
    },
    globalAcceptanceCriteria: NONEMPTY_STRING_ARRAY,
    requiredChecks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "reason"],
        properties: {
          id: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "description", "mitigation"],
        properties: {
          category: { type: "string" },
          description: { type: "string" },
          mitigation: { type: "string" },
        },
      },
    },
    replanTriggers: STRING_ARRAY,
  },
};

export const SCOUT_OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "ScoutOutput",
  type: "object",
  additionalProperties: false,
  required: ["version", "summary", "areas", "risks", "recommendations"],
  properties: {
    version: { type: "number", const: 1 },
    summary: { type: "string", minLength: 1, maxLength: 2000, pattern: "\\S" },
    areas: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "findings"],
        properties: {
          path: { type: "string", minLength: 1, maxLength: 1024, pattern: "\\S" },
          findings: { type: "string", minLength: 1, maxLength: 2000, pattern: "\\S" },
        },
      },
    },
    risks: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 1000, pattern: "\\S" } },
    recommendations: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 1000, pattern: "\\S" } },
  },
};

export const ARCHIVIST_OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "ArchivistOutput",
  type: "object",
  additionalProperties: false,
  required: ["version", "lessons"],
  properties: {
    version: { type: "number", const: 1 },
    lessons: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["content", "importance"],
        properties: {
          content: { type: "string", minLength: 1, maxLength: 2000, pattern: "\\S" },
          importance: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

export const IMPLEMENTATION_OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "ImplementationOutput",
  type: "object",
  additionalProperties: false,
  required: ["version", "status", "summary", "claimedChangedFiles", "addressedFindingIds", "remainingConcerns"],
  properties: {
    version: { type: "number", const: 1 },
    status: { type: "string", enum: ["completed", "blocked", "needs_replan"] },
    summary: { type: "string" },
    claimedChangedFiles: STRING_ARRAY,
    addressedFindingIds: STRING_ARRAY,
    remainingConcerns: STRING_ARRAY,
    verification: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "status", "evidence"],
        properties: {
          criterion: NONEMPTY_STRING,
          status: { type: "string", enum: ["passed", "failed", "not_run"] },
          evidence: NONEMPTY_STRING,
          artifactPaths: { type: "array", items: NONEMPTY_STRING, uniqueItems: true },
        },
      },
    },
    replanReason: { type: "string" },
    durableLessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["content", "importance"],
        properties: {
          content: { type: "string" },
          importance: { type: "number" },
        },
      },
    },
  },
  if: { properties: { status: { const: "needs_replan" } }, required: ["status"] },
  then: { properties: { replanReason: NONEMPTY_STRING }, required: ["replanReason"] },
};

export const SECURITY_OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "SecurityOutput",
  type: "object",
  additionalProperties: false,
  required: ["version", "verdict", "scope", "findings", "residualRisks"],
  properties: {
    version: { type: "number", const: 1 },
    verdict: GATE_VERDICT,
    scope: {
      type: "object",
      additionalProperties: false,
      required: ["revisionId", "reviewedAreas"],
      properties: {
        revisionId: { type: "string" },
        reviewedAreas: STRING_ARRAY,
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "category", "title", "description", "evidence", "exploitOrImpact", "fixRequirement", "confidence"],
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
          category: { type: "string" },
          title: { type: "string" },
          file: { type: "string" },
          lineStart: { type: "number" },
          lineEnd: { type: "number" },
          symbol: { type: "string" },
          description: { type: "string" },
          evidence: { type: "string" },
          exploitOrImpact: { type: "string" },
          fixRequirement: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    residualRisks: STRING_ARRAY,
    verificationIndependent: { type: "boolean" },
    liveValidation: { type: "boolean" },
    blockedReason: { type: "string" },
  },
  allOf: GATE_CONDITIONS,
};

export const REVIEW_OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "ReviewOutput",
  type: "object",
  additionalProperties: false,
  required: ["version", "verdict", "acceptance", "findings", "notes"],
  properties: {
    version: { type: "number", const: 1 },
    verdict: GATE_VERDICT,
    acceptance: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "status", "evidence"],
        properties: {
          criterion: { type: "string" },
          status: { type: "string", enum: ["satisfied", "not_satisfied", "uncertain"] },
          evidence: { type: "string" },
        },
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "category", "title", "description", "evidence", "fixRequirement"],
        properties: {
          severity: { type: "string", enum: ["blocking", "major", "minor"] },
          category: { type: "string" },
          title: { type: "string" },
          file: { type: "string" },
          lineStart: { type: "number" },
          lineEnd: { type: "number" },
          symbol: { type: "string" },
          description: { type: "string" },
          evidence: { type: "string" },
          fixRequirement: { type: "string" },
        },
      },
    },
    notes: STRING_ARRAY,
    blockedReason: { type: "string" },
  },
  allOf: GATE_CONDITIONS,
};
