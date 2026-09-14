import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { AnvilError } from "../util/errors.ts";
import type { ImplementationOutput, PlanOutput, ReviewOutput, SecurityOutput } from "../workflow/types.ts";
import { IMPLEMENTATION_OUTPUT_SCHEMA, PLAN_OUTPUT_SCHEMA, REVIEW_OUTPUT_SCHEMA, SECURITY_OUTPUT_SCHEMA } from "./outputs.ts";

const ajv = new Ajv({
  strict: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
const validatePlan = ajv.compile<PlanOutput>(PLAN_OUTPUT_SCHEMA);
const validateImplementation = ajv.compile<ImplementationOutput>(IMPLEMENTATION_OUTPUT_SCHEMA);
const validateSecurity = ajv.compile<SecurityOutput>(SECURITY_OUTPUT_SCHEMA);
const validateReview = ajv.compile<ReviewOutput>(REVIEW_OUTPUT_SCHEMA);

function requireOutput<T>(value: unknown, validate: ValidateFunction<T>, role: string): T {
  if (validate(value)) return value;

  const error: ErrorObject<string, Record<string, unknown>> | undefined = validate.errors?.[0];
  let path = error?.instancePath ?? "";
  const property = error?.keyword === "required"
    ? error.params.missingProperty
    : error?.keyword === "additionalProperties"
    ? error.params.additionalProperty
    : undefined;
  if (typeof property === "string") path += `/${property.replaceAll("~", "~0").replaceAll("/", "~1")}`;
  const detail = error ? `${error.message} (${JSON.stringify(error.params)})` : "does not match its output schema";
  throw new AnvilError("SCHEMA_INVALID", `${role} output ${path || "/"} ${detail}`);
}

export function requirePlan(value: unknown): PlanOutput {
  const plan = requireOutput(value, validatePlan, "Architect");
  const ids = new Set<string>();
  for (let index = 0; index < plan.steps.length; index++) {
    const step = plan.steps[index];
    if (ids.has(step.id)) {
      throw new AnvilError("SCHEMA_INVALID", `Architect output /steps/${index}/id duplicates step ID ${JSON.stringify(step.id)}`);
    }
    ids.add(step.id);
  }
  for (let index = 0; index < plan.steps.length; index++) {
    const dependencies = plan.steps[index].dependsOn;
    for (let dependencyIndex = 0; dependencyIndex < dependencies.length; dependencyIndex++) {
      const dependency = dependencies[dependencyIndex];
      if (!ids.has(dependency)) {
        throw new AnvilError(
          "SCHEMA_INVALID",
          `Architect output /steps/${index}/dependsOn/${dependencyIndex} references unknown step ID ${JSON.stringify(dependency)}`,
        );
      }
    }
  }
  return plan;
}

export function requireImplementation(value: unknown): ImplementationOutput {
  return requireOutput(value, validateImplementation, "Smith");
}

export function requireSecurity(value: unknown): SecurityOutput {
  return requireOutput(value, validateSecurity, "Sentinel");
}

export function requireReview(value: unknown): ReviewOutput {
  return requireOutput(value, validateReview, "Inquisitor");
}
