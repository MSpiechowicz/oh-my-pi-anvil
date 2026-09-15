import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { findRepositoryRoot, globalConfigPath, projectConfigPath } from "../state/paths.ts";
import { DEFAULT_CONFIG } from "./defaults.ts";

/** A non-destructive result for one configuration file. */
export interface InitFileReport {
  path: string;
  status: "created" | "existing";
}

/** The paths and outcomes reported by /anvil init. */
export interface InitReport {
  global: InitFileReport;
  project?: InitFileReport;
  repositoryRoot?: string;
  created: string[];
  existing: string[];
}

/** Complete editable defaults, serialized as JSON (also accepted in anvil.yml).
 * Null limits are unlimited; null agent options inherit OMP settings.
 * Empty checks enable discovery without persisting repository-specific commands.
 */
export const GLOBAL_CONFIG_TEMPLATE = `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`;

/** Deliberately sparse repository overlay; values here override global settings. */
export const PROJECT_CONFIG_TEMPLATE = `# Repository-specific Forge overrides.
# Values here override the global settings; omitted values continue to inherit.
# Empty effective checks discover supported verification scripts from root manifests.
# Nonempty explicit checks override discovery; discovered checks are all required.
# No supported checks means the run stops; see docs/configuration.md for overrides.
version: 1
`;

/** Create the editable global settings file without touching any repository. */
export async function ensureGlobalConfig(): Promise<InitFileReport> {
  return createIfMissing(globalConfigPath(), GLOBAL_CONFIG_TEMPLATE);
}

/**
 * Create missing global and repository configuration files without replacing user data.
 * A repository overlay is only created when a Git-style root can be found.
 */
export async function initConfig(workspaceRoot: string): Promise<InitReport> {
  const created: string[] = [];
  const existing: string[] = [];
  const global = await createIfMissing(globalConfigPath(), GLOBAL_CONFIG_TEMPLATE);
  record(global, created, existing);

  const repositoryRoot = await findRepositoryRoot(workspaceRoot);
  if (!repositoryRoot) return { global, created, existing };

  const project = await createIfMissing(projectConfigPath(repositoryRoot), PROJECT_CONFIG_TEMPLATE);
  record(project, created, existing);
  return { global, project, repositoryRoot, created, existing };
}

async function createIfMissing(filePath: string, content: string): Promise<InitFileReport> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
    return { path: filePath, status: "created" };
  } catch (error) {
    if (isAlreadyExists(error)) return { path: filePath, status: "existing" };
    throw error;
  }
}

function record(report: InitFileReport, created: string[], existing: string[]): void {
  (report.status === "created" ? created : existing).push(report.path);
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
