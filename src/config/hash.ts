import type { WorkflowConfig } from "../workflow/types.ts";
import { hashJson } from "../util/hash.ts";
export function configHash(config: WorkflowConfig): string { return hashJson(config); }
