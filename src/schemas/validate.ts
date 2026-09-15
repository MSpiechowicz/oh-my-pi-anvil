import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { AnvilError } from "../util/errors.ts";
import type { ArchivistOutput, ImplementationOutput, PlanOutput, ReviewOutput, ScoutOutput, SecurityOutput, SmithDispatchOutput, SmithTask } from "../workflow/types.ts";
import { ARCHIVIST_OUTPUT_SCHEMA, IMPLEMENTATION_OUTPUT_SCHEMA, PLAN_OUTPUT_SCHEMA, REVIEW_OUTPUT_SCHEMA, SCOUT_OUTPUT_SCHEMA, SECURITY_OUTPUT_SCHEMA, SMITH_DISPATCH_OUTPUT_SCHEMA } from "./outputs.ts";

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
const validateScout = ajv.compile<ScoutOutput>(SCOUT_OUTPUT_SCHEMA);
const validateArchivist = ajv.compile<ArchivistOutput>(ARCHIVIST_OUTPUT_SCHEMA);
const validateSmithDispatch = ajv.compile<SmithDispatchOutput>(SMITH_DISPATCH_OUTPUT_SCHEMA);

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

function requireTaskGraph(tasks: SmithTask[], role: string, path: string): void {
  const byId = new Map<string, SmithTask>();
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    if (byId.has(task.id)) throw new AnvilError("SCHEMA_INVALID", `${role} output ${path}/${index}/id duplicates task ID ${JSON.stringify(task.id)}`);
    byId.set(task.id, task);
  }
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    for (const dependency of task.dependsOn) {
      if (dependency === task.id || !byId.has(dependency)) {
        throw new AnvilError("SCHEMA_INVALID", `${role} output ${path}/${index}/dependsOn references ${dependency === task.id ? "its own" : "unknown"} task ID ${JSON.stringify(dependency)}`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (task: SmithTask): void => {
    if (visiting.has(task.id)) throw new AnvilError("SCHEMA_INVALID", `${role} output ${path} contains a dependency cycle at task ID ${JSON.stringify(task.id)}`);
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    for (const dependency of task.dependsOn) visit(byId.get(dependency)!);
    visiting.delete(task.id);
    visited.add(task.id);
  };
  for (const task of tasks) visit(task);
}

export function requireSmithDispatch(value: unknown): SmithDispatchOutput {
  const dispatch = requireOutput(value, validateSmithDispatch, "Architect dispatch");
  requireTaskGraph(dispatch.tasks, "Architect dispatch", "/tasks");
  return dispatch;
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
  requireTaskGraph(plan.smithTasks, "Architect", "/smithTasks");
  return plan;
}

export function requireImplementation(value: unknown): ImplementationOutput {
  return requireOutput(value, validateImplementation, "Smith");
}

export function requireSecurity(value: unknown): SecurityOutput {
  const output = requireOutput(value, validateSecurity, "Sentinel");
  if (output.smithTasks) requireTaskGraph(output.smithTasks, "Sentinel", "/smithTasks");
  return output;
}

export function requireReview(value: unknown): ReviewOutput {
  const output = requireOutput(value, validateReview, "Inquisitor");
  if (output.smithTasks) requireTaskGraph(output.smithTasks, "Inquisitor", "/smithTasks");
  return output;
}

export function requireScout(value: unknown): ScoutOutput {
  return requireOutput(value, validateScout, "Scout");
}

export function requireArchivist(value: unknown): ArchivistOutput {
  return requireOutput(value, validateArchivist, "Archivist");
}
