import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { globalConfigPath, findRepositoryRoot, projectConfigPath } from "../state/paths.ts";

/** A non-destructive result for one configuration file. */
export interface InitFileReport {
  path: string;
  status: "created" | "existing";
}

/** The paths and outcomes reported by /forge init. */
export interface InitReport {
  global: InitFileReport;
  project?: InitFileReport;
  repositoryRoot?: string;
  created: string[];
  existing: string[];
  detected: string[];
  detectedAlternates: string[];
  /** Alias useful to renderers that specifically label alternate settings. */
  alternates: string[];
}

/** Editable user-wide settings. Omitted values inherit built-in defaults. */
export const GLOBAL_CONFIG_TEMPLATE = `# Shared Forge settings for all repositories.
# Omitted values inherit Anvil's built-in defaults.
version: 1
workflow:
  name: secure-code-change
agents:
  planner:
    agent: orchestrator-planner
  implementation:
    agent: orchestrator-implementation
  security:
    agent: orchestrator-security
  review:
    agent: orchestrator-reviewer

# Add shared checks or override budgets below.
`;

/** Deliberately sparse repository overlay; values here override global settings. */
export const PROJECT_CONFIG_TEMPLATE = `# Repository-specific Forge overrides.
# Values here override the global settings; omitted values continue to inherit.
version: 1
`;

const ALTERNATE_PROJECT_SETTINGS = [
  path.join(".omp", "orchestrator.json"),
  path.join(".omp", "anvil.yml"),
  ".anvil.yml",
  "anvil.yml",
];

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
  if (!repositoryRoot) {
    return { global, created, existing, detected: [], detectedAlternates: [], alternates: [] };
  }

  const detectedAlternates: string[] = [];
  for (const relativePath of ALTERNATE_PROJECT_SETTINGS) {
    const alternate = path.join(repositoryRoot, relativePath);
    try {
      await access(alternate);
      detectedAlternates.push(alternate);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  const canonicalPath = projectConfigPath(repositoryRoot);
  let project: InitFileReport | undefined;
  if (detectedAlternates.length === 0) {
    project = await createIfMissing(canonicalPath, PROJECT_CONFIG_TEMPLATE);
    record(project, created, existing);
  } else {
    try {
      await access(canonicalPath);
      project = { path: canonicalPath, status: "existing" };
      record(project, created, existing);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  const detected = [ ...(project?.status === "existing" ? [project.path] : []), ...detectedAlternates ];
  return { global, project, repositoryRoot, created, existing, detected, detectedAlternates, alternates: detectedAlternates };
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

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
