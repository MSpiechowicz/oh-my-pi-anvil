// src/runtime.ts
import path8 from "node:path";

// src/config/load.ts
import { access as access2, readFile } from "node:fs/promises";
import path2 from "node:path";

// src/config/defaults.ts
var DEFAULT_CONFIG = {
  version: 1,
  workflow: {
    name: "secure-code-change"
  },
  agents: {
    planner: {
      agent: "architect"
    },
    implementation: {
      agent: "smith"
    },
    security: {
      agent: "sentinel"
    },
    review: {
      agent: "inquisitor"
    }
  },
  checks: [],
  checksFailFast: true,
  security: {
    failOn: [
      "critical",
      "high",
      "medium"
    ],
    maxAttempts: 3,
    policyVersion: 1
  },
  review: {
    maxAttempts: 3,
    blockOn: [
      "blocking",
      "major"
    ],
    policyVersion: 1
  },
  implementation: {
    maxAttempts: 6,
    isolation: {
      enabled: false,
      merge: "patch"
    }
  },
  planning: {
    maxGenerations: 2,
    maxAttempts: 2
  },
  budgets: {
    maxTotalTokens: 25e4,
    maxTotalRequests: 120,
    maxTransitions: 40,
    maxWallClockMs: 72e5,
    perRole: {
      planner: {
        maxTokens: 4e4,
        maxAttempts: 2
      },
      implementation: {
        maxTokens: 12e4,
        maxAttempts: 6
      },
      security: {
        maxTokens: 6e4,
        maxAttempts: 3
      },
      review: {
        maxTokens: 5e4,
        maxAttempts: 3
      }
    }
  },
  context: {
    maxInlineChars: 12e3,
    maxMemoryItems: 5,
    maxMemoryChars: 5e3,
    maxFindingSummaryChars: 6e3,
    maxChangedFiles: 200
  },
  memory: {
    enabled: true,
    retainOnSuccess: true,
    maxRetainedLessons: 3
  },
  persistence: {
    root: ".omp/.anvil",
    keepAgentRawArtifacts: true,
    keepCommandLogs: true,
    persistRenderedPrompts: false
  },
  safety: {
    oneMutatingRunPerWorkspace: true,
    securityMustBeReadOnly: true,
    reviewerMustBeReadOnly: true,
    refusePathEscapeFromWorkspace: true
  }
};

// src/util/errors.ts
var AnvilError = class extends Error {
  code;
  constructor(code, message, cause) {
    super(message, {
      cause
    });
    this.code = code;
    this.name = `AnvilError(${code})`;
  }
};
function asAnvilError(error, fallback = "PERSISTENCE_ERROR") {
  return error instanceof AnvilError ? error : new AnvilError(fallback, error instanceof Error ? error.message : String(error), error);
}

// src/config/schema.ts
var ROLES = [
  "planner",
  "implementation",
  "security",
  "review"
];
var SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "info"
];
var TOP_LEVEL_KEYS = [
  "version",
  "workflow",
  "agents",
  "checks",
  "checksFailFast",
  "security",
  "review",
  "implementation",
  "planning",
  "budgets",
  "context",
  "memory",
  "persistence",
  "safety"
];
function rejectUnknownKeys(value2, allowed, label) {
  for (const key of Object.keys(value2)) if (!allowed.includes(key)) throw new AnvilError("CONFIG_INVALID", `Unknown ${label} key: ${key}`);
}
function validateConfig(config) {
  rejectUnknownKeys(config, TOP_LEVEL_KEYS, "top-level config");
  rejectUnknownKeys(config.workflow, [
    "name"
  ], "workflow");
  for (const role of ROLES) rejectUnknownKeys(config.agents[role], [
    "agent",
    "model",
    "effort"
  ], `agents.${role}`);
  for (const check of config.checks ?? []) rejectUnknownKeys(check, [
    "id",
    "command",
    "cwd",
    "env",
    "required",
    "timeoutMs"
  ], `check ${check.id}`);
  rejectUnknownKeys(config.security, [
    "failOn",
    "maxAttempts",
    "policyVersion"
  ], "security");
  rejectUnknownKeys(config.review, [
    "maxAttempts",
    "blockOn",
    "policyVersion"
  ], "review");
  rejectUnknownKeys(config.implementation, [
    "maxAttempts",
    "isolation"
  ], "implementation");
  rejectUnknownKeys(config.implementation.isolation, [
    "enabled",
    "merge"
  ], "implementation.isolation");
  rejectUnknownKeys(config.planning, [
    "maxGenerations",
    "maxAttempts"
  ], "planning");
  rejectUnknownKeys(config.budgets, [
    "maxTotalTokens",
    "maxTotalRequests",
    "maxTransitions",
    "maxWallClockMs",
    "perRole"
  ], "budgets");
  for (const role of ROLES) if (config.budgets.perRole[role]) rejectUnknownKeys(config.budgets.perRole[role], [
    "maxTokens",
    "maxAttempts",
    "maxRequests"
  ], `budgets.perRole.${role}`);
  rejectUnknownKeys(config.context, [
    "maxInlineChars",
    "maxMemoryItems",
    "maxMemoryChars",
    "maxFindingSummaryChars",
    "maxChangedFiles"
  ], "context");
  rejectUnknownKeys(config.memory, [
    "enabled",
    "retainOnSuccess",
    "maxRetainedLessons"
  ], "memory");
  rejectUnknownKeys(config.persistence, [
    "root",
    "keepAgentRawArtifacts",
    "keepCommandLogs",
    "persistRenderedPrompts"
  ], "persistence");
  rejectUnknownKeys(config.safety, [
    "oneMutatingRunPerWorkspace",
    "securityMustBeReadOnly",
    "reviewerMustBeReadOnly",
    "refusePathEscapeFromWorkspace"
  ], "safety");
  const ids = /* @__PURE__ */ new Set();
  for (const check of config.checks ?? []) {
    if (!check.id || ids.has(check.id)) throw new AnvilError("CONFIG_INVALID", `Duplicate or empty check id: ${check.id}`);
    if (!Array.isArray(check.command) || check.command.length === 0) throw new AnvilError("CONFIG_INVALID", `Check ${check.id} needs an argv command`);
    if (check.timeoutMs <= 0) throw new AnvilError("CONFIG_INVALID", `Check ${check.id} timeout must be positive`);
    ids.add(check.id);
  }
  const severities = new Set(SEVERITIES);
  for (const severity of config.security.failOn) if (!severities.has(severity)) throw new AnvilError("CONFIG_INVALID", `Unknown security severity ${severity}`);
  if (config.implementation.maxAttempts <= 0 || config.security.maxAttempts <= 0 || config.review.maxAttempts <= 0 || config.planning.maxAttempts <= 0) throw new AnvilError("CONFIG_INVALID", "Attempt limits must be positive");
  for (const value2 of [
    config.budgets.maxTotalTokens,
    config.budgets.maxTotalRequests,
    config.budgets.maxTransitions,
    config.budgets.maxWallClockMs
  ]) if (value2 !== void 0 && value2 <= 0) throw new AnvilError("CONFIG_INVALID", "Budget limits must be positive");
  if (config.context.maxInlineChars <= 0 || config.context.maxChangedFiles <= 0) throw new AnvilError("CONFIG_INVALID", "Context limits must be positive");
  return config;
}

// src/state/paths.ts
import { access, mkdir, realpath, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import process2 from "node:process";
import path from "node:path";
function environment(name) {
  try {
    return process2.env[name] || void 0;
  } catch {
    return void 0;
  }
}
function globalConfigPath() {
  const xdg = environment("XDG_CONFIG_HOME");
  if (xdg) return path.resolve(xdg, "omp", "anvil.yml");
  let home = environment("HOME");
  if (!home) {
    try {
      home = homedir();
    } catch {
      home = path.resolve(".");
    }
  }
  return path.resolve(home, ".config", "omp", "anvil.yml");
}
function globalModelsConfigPath() {
  const profile = environment("OMP_PROFILE") ?? environment("PI_PROFILE");
  let home = environment("HOME");
  if (!home) {
    try {
      home = homedir();
    } catch {
      home = path.resolve(".");
    }
  }
  if (profile && profile !== "default") return path.resolve(home, ".omp", "profiles", profile, "agent", "config.yml");
  const agentDirectory = environment("PI_CODING_AGENT_DIR");
  if (agentDirectory) return path.resolve(agentDirectory, "config.yml");
  return path.resolve(home, ".omp", "agent", "config.yml");
}
function projectConfigPath(repositoryRoot) {
  return path.join(path.resolve(repositoryRoot), ".omp", "anvil.yml");
}
async function findRepositoryRoot(workspaceRoot) {
  let current = path.resolve(workspaceRoot);
  while (true) {
    try {
      await access(path.join(current, ".git"));
      return current;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) return void 0;
      current = parent;
    }
  }
}
async function nearestProjectConfigPath(workspaceRoot) {
  const workspace = path.resolve(workspaceRoot);
  const repository = await findRepositoryRoot(workspace);
  if (!repository) return existingPathOrUndefined(projectConfigPath(workspace));
  let current = workspace;
  while (true) {
    const candidate = await existingPathOrUndefined(projectConfigPath(current));
    if (candidate) return candidate;
    if (current === repository) return void 0;
    const parent = path.dirname(current);
    if (parent === current) return void 0;
    current = parent;
  }
}
async function existingPathOrUndefined(candidate) {
  try {
    await access(candidate);
    return candidate;
  } catch (error) {
    if (isMissing(error)) return void 0;
    throw error;
  }
}
function isMissing(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function runtimeRoot(workspaceRoot, configured) {
  return path.isAbsolute(configured) ? configured : path.resolve(workspaceRoot, configured);
}
async function ensureRuntimeRoot(root) {
  await mkdir(root, {
    recursive: true
  });
  await mkdir(path.join(root, "runs"), {
    recursive: true
  });
}
function containedPath(root, relativePath) {
  if (path.isAbsolute(relativePath)) throw new AnvilError("ARTIFACT_CORRUPT", "Absolute artifact paths are not allowed");
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new AnvilError("ARTIFACT_CORRUPT", "Artifact path escapes its run root");
  return resolved;
}
async function assertSafeSymlink(root, target) {
  try {
    const info = await lstat(target);
    if (!info.isSymbolicLink()) return;
    const resolved = await realpath(target);
    containedPath(root, path.relative(root, resolved));
  } catch (error) {
    if (error instanceof AnvilError) throw error;
  }
}

// src/config/load.ts
async function loadConfig(root, explicitPath) {
  const layers = [
    await readConfigFile(globalConfigPath())
  ];
  const configPath = explicitPath ?? await nearestProjectConfigPath(root);
  if (configPath) layers.push(await readConfigFile(configPath));
  let merged = structuredClone(DEFAULT_CONFIG);
  for (const layer of layers) if (layer) merged = mergeConfig(merged, layer);
  return validateConfig(merged);
}
function mergeConfig(base, input) {
  const merge = (target, source) => {
    for (const [key, value2] of Object.entries(source)) {
      if (isRecord(value2)) {
        const existing = target[key];
        const child = isRecord(existing) ? existing : {};
        merge(child, value2);
        target[key] = child;
      } else {
        target[key] = value2;
      }
    }
  };
  merge(base, input);
  return base;
}
async function readConfigFile(configPath) {
  let raw;
  try {
    await access2(configPath);
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isMissing2(error)) return void 0;
    throw error;
  }
  try {
    const parsed = path2.extname(configPath).toLowerCase() === ".json" || raw.trim().startsWith("{") ? JSON.parse(raw) : parseSimpleYaml(raw);
    if (!isRecord(parsed)) {
      throw new AnvilError("CONFIG_INVALID", `Configuration must be an object: ${configPath}`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof AnvilError) throw error;
    throw new AnvilError("CONFIG_INVALID", `Invalid configuration: ${configPath}`, error);
  }
}
function isMissing2(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function isRecord(value2) {
  return Boolean(value2) && typeof value2 === "object" && !Array.isArray(value2);
}
function parseSimpleYaml(text) {
  try {
    if (text.trim().startsWith("{")) return JSON.parse(text);
  } catch (error) {
    throw new AnvilError("CONFIG_INVALID", "Invalid JSON workflow configuration", error);
  }
  const root = {};
  const lines = text.split(/\r?\n/).map((sourceLine) => sourceLine.replace(/\s+#.*$/, "")).filter((line) => line.trim() && !line.trim().startsWith("#"));
  const stack = [
    {
      indent: -1,
      value: root
    }
  ];
  for (let index = 0; index < lines.length; index += 1) {
    const sourceLine = lines[index];
    const indent = sourceLine.length - sourceLine.trimStart().length;
    const trimmed = sourceLine.trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;
    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(parent)) throw new AnvilError("CONFIG_INVALID", `List item has no list parent: ${sourceLine}`);
      const item = trimmed.slice(2).trim();
      const match2 = item.match(/^([^:]+):(?:\s*(.*))?$/);
      if (!match2) {
        parent.push(parseScalar(item));
        continue;
      }
      const object = {};
      parent.push(object);
      const value3 = (match2[2] ?? "").trim();
      object[match2[1].trim()] = value3 ? parseScalar(value3) : {};
      if (!value3) stack.push({
        indent,
        value: object[match2[1].trim()]
      });
      else stack.push({
        indent,
        value: object
      });
      continue;
    }
    const match = trimmed.match(/^([^:]+):(?:\s*(.*))?$/);
    if (!match || Array.isArray(parent)) throw new AnvilError("CONFIG_INVALID", `Unsupported YAML line: ${sourceLine}`);
    const key = match[1].trim();
    const value2 = (match[2] ?? "").trim();
    if (value2) {
      parent[key] = parseScalar(value2);
      continue;
    }
    const next = lines[index + 1]?.trim() ?? "";
    const container = next.startsWith("- ") ? [] : {};
    parent[key] = container;
    stack.push({
      indent,
      value: container
    });
  }
  return root;
}
function parseScalar(value2) {
  if (value2 === "true") return true;
  if (value2 === "false") return false;
  if (value2 === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value2)) return Number(value2);
  if (value2.startsWith('"') && value2.endsWith('"') || value2.startsWith("'") && value2.endsWith("'")) return value2.slice(1, -1);
  if (value2.startsWith("[") && value2.endsWith("]")) return value2.slice(1, -1).split(",").map((part) => parseScalar(part.trim()));
  return value2;
}

// src/state/sqlite.ts
import { DatabaseSync } from "node:sqlite";
function prepare(database, sql) {
  return database.prepare(sql);
}
function positional(params) {
  if (!params) return [];
  if (Array.isArray(params)) return params;
  throw new TypeError("Named SQLite parameters are not supported by this adapter");
}
var Database = class {
  database;
  constructor(filename, _options) {
    this.database = new DatabaseSync(filename);
  }
  exec(sql) {
    this.database.exec(sql);
  }
  run(sql, params) {
    const result = prepare(this.database, sql).run(...positional(params));
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid)
    };
  }
  query(sql) {
    return {
      get: (...params) => prepare(this.database, sql).get(...params),
      all: (...params) => prepare(this.database, sql).all(...params),
      run: (...params) => {
        const result = prepare(this.database, sql).run(...params);
        return {
          changes: result.changes,
          lastInsertRowid: Number(result.lastInsertRowid)
        };
      }
    };
  }
  close() {
    this.database.close();
  }
};

// src/state/database.ts
import { mkdir as mkdir2 } from "node:fs/promises";
import path3 from "node:path";

// src/state/migrations.ts
function applyMigrations(db) {
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`);
  const applied = db.query("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version);
  if (applied.includes(1)) return;
  db.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, workflow_name TEXT NOT NULL, workflow_version INTEGER NOT NULL, config_hash TEXT NOT NULL,
      workspace_root TEXT NOT NULL, objective_path TEXT NOT NULL, plan_path TEXT, base_revision_id TEXT NOT NULL, current_revision_id TEXT NOT NULL,
      mutation_epoch INTEGER NOT NULL DEFAULT 0, current_state TEXT NOT NULL, status TEXT NOT NULL, active_attempt_id TEXT,
      max_total_tokens INTEGER, max_total_requests INTEGER, max_transitions INTEGER, max_wall_clock_ms INTEGER,
      used_tokens INTEGER NOT NULL DEFAULT 0, used_input_tokens INTEGER NOT NULL DEFAULT 0, used_output_tokens INTEGER NOT NULL DEFAULT 0,
      used_cache_read_tokens INTEGER NOT NULL DEFAULT 0, used_cache_write_tokens INTEGER NOT NULL DEFAULT 0, used_requests INTEGER NOT NULL DEFAULT 0,
      transition_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      blocked_reason TEXT, failure_code TEXT, failure_message TEXT, initial_head TEXT NOT NULL
    );
    CREATE TABLE attempts (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, state TEXT NOT NULL, role TEXT,
      agent_name TEXT, model_selector TEXT, input_artifact_id TEXT, output_artifact_id TEXT, base_revision_id TEXT NOT NULL, result_revision_id TEXT,
      status TEXT NOT NULL, verdict TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0, context_tokens INTEGER, context_window INTEGER, duration_ms INTEGER, started_at TEXT NOT NULL,
      ended_at TEXT, error_code TEXT, error_message TEXT, UNIQUE(run_id, sequence)
    );
    CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, timestamp TEXT NOT NULL,
      type TEXT NOT NULL, actor TEXT NOT NULL, state_before TEXT, state_after TEXT, revision_id TEXT, payload_json TEXT NOT NULL);
    CREATE INDEX idx_events_run_seq ON events(run_id, seq);
    CREATE TABLE artifacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
      kind TEXT NOT NULL, relative_path TEXT NOT NULL, media_type TEXT NOT NULL, sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(run_id, relative_path));
    CREATE TABLE findings (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, source_gate TEXT NOT NULL, fingerprint TEXT NOT NULL,
      severity TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, fix_requirement TEXT, file_path TEXT, line_start INTEGER,
      line_end INTEGER, status TEXT NOT NULL, first_seen_epoch INTEGER NOT NULL, last_seen_epoch INTEGER NOT NULL, times_seen INTEGER NOT NULL DEFAULT 1,
      reopen_count INTEGER NOT NULL DEFAULT 0, first_attempt_id TEXT NOT NULL, last_attempt_id TEXT NOT NULL, evidence_artifact_id TEXT, resolved_attempt_id TEXT,
      resolution_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(run_id, source_gate, fingerprint));
    CREATE TABLE gate_results (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, gate TEXT NOT NULL, revision_id TEXT NOT NULL,
      mutation_epoch INTEGER NOT NULL, config_hash TEXT NOT NULL, gate_policy_hash TEXT NOT NULL, verdict TEXT NOT NULL, attempt_id TEXT, artifact_id TEXT,
      started_at TEXT NOT NULL, ended_at TEXT NOT NULL, UNIQUE(run_id, gate, revision_id, config_hash, gate_policy_hash));
    INSERT INTO schema_migrations(version, applied_at) VALUES (1, '${(/* @__PURE__ */ new Date()).toISOString()}');
  `);
}

// src/state/database.ts
var StateDatabase = class _StateDatabase {
  filePath;
  db;
  constructor(filePath, db) {
    this.filePath = filePath;
    this.db = db;
  }
  static async open(root) {
    await mkdir2(root, {
      recursive: true
    });
    const database = new Database(path3.join(root, "anvil.db"), {
      create: true,
      readwrite: true
    });
    applyMigrations(database);
    return new _StateDatabase(path3.join(root, "anvil.db"), database);
  }
  close() {
    this.db.close();
  }
};

// src/state/artifact-store.ts
import { mkdir as mkdir3, readFile as readFile2, rename, writeFile } from "node:fs/promises";
import path4 from "node:path";

// src/util/hash.ts
import { createHash } from "node:crypto";

// src/util/json.ts
function stableJson(value2) {
  return JSON.stringify(sortValue(value2));
}
function sortValue(value2) {
  if (Array.isArray(value2)) return value2.map(sortValue);
  if (value2 && typeof value2 === "object") {
    return Object.fromEntries(Object.entries(value2).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [
      key,
      sortValue(child)
    ]));
  }
  return value2;
}
function boundedText(value2, maxChars) {
  if (value2.length <= maxChars) return value2;
  return `${value2.slice(0, Math.max(0, maxChars - 1))}\u2026`;
}

// src/util/hash.ts
function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}
function hashJson(value2) {
  return sha256(stableJson(value2));
}

// src/state/artifact-store.ts
var ArtifactStore = class {
  state;
  runRoot;
  constructor(state, runRoot) {
    this.state = state;
    this.runRoot = runRoot;
  }
  async putText(runId, kind, relativePath, content, mediaType = "text/plain", attemptId) {
    return this.putBytes(runId, kind, relativePath, new TextEncoder().encode(content), mediaType, attemptId);
  }
  async putJson(runId, kind, relativePath, value2, attemptId) {
    return this.putText(runId, kind, relativePath, JSON.stringify(value2, null, 2), "application/json", attemptId);
  }
  async putBytes(runId, kind, relativePath, bytes, mediaType, attemptId) {
    const root = this.runRoot(runId);
    const target = containedPath(root, relativePath);
    await mkdir3(path4.dirname(target), {
      recursive: true
    });
    await assertSafeSymlink(root, target);
    const temp = `${target}.tmp-${crypto.randomUUID()}`;
    await writeFile(temp, bytes);
    await rename(temp, target);
    const pointer = {
      id: `art_${crypto.randomUUID()}`,
      path: relativePath,
      sha256: sha256(bytes)
    };
    this.state.db.run("INSERT OR REPLACE INTO artifacts(id, run_id, attempt_id, kind, relative_path, media_type, sha256, byte_length, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      pointer.id,
      runId,
      attemptId ?? null,
      kind,
      relativePath,
      mediaType,
      pointer.sha256,
      bytes.byteLength,
      (/* @__PURE__ */ new Date()).toISOString()
    ]);
    return pointer;
  }
  async readText(runId, pointer) {
    const target = containedPath(this.runRoot(runId), pointer.path);
    const bytes = new Uint8Array(await readFile2(target));
    if (sha256(bytes) !== pointer.sha256) throw new AnvilError("ARTIFACT_CORRUPT", `Artifact hash mismatch: ${pointer.path}`);
    return new TextDecoder().decode(bytes);
  }
  async readJson(runId, pointer) {
    return JSON.parse(await this.readText(runId, pointer));
  }
};

// src/state/lock.ts
import { mkdir as mkdir4, readFile as readFile3, unlink, open, writeFile as writeFile2, rename as rename2 } from "node:fs/promises";
import path5 from "node:path";
var WorkspaceLock = class _WorkspaceLock {
  root;
  static active = /* @__PURE__ */ new Set();
  held;
  constructor(root) {
    this.root = root;
    this.held = false;
  }
  async acquire(runId, staleAfterMs = 30 * 60 * 1e3) {
    if (_WorkspaceLock.active.has(this.root)) throw new AnvilError("RUN_LOCKED", `Workspace already has an active Anvil run: ${this.root}`);
    await mkdir4(path5.dirname(this.root), {
      recursive: true
    });
    const now2 = (/* @__PURE__ */ new Date()).toISOString();
    const record2 = {
      runId,
      pid: process.pid,
      hostname: process.env.HOSTNAME ?? "unknown",
      startedAt: now2,
      heartbeatAt: now2
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(this.root, "wx");
        await handle.writeFile(JSON.stringify(record2, null, 2));
        await handle.close();
        _WorkspaceLock.active.add(this.root);
        this.held = true;
        return;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
        let existing;
        try {
          existing = JSON.parse(await readFile3(this.root, "utf8"));
        } catch {
          existing = void 0;
        }
        if (existing && Date.now() - Date.parse(existing.heartbeatAt) < staleAfterMs) throw new AnvilError("RUN_LOCKED", `Workspace locked by run ${existing.runId}`);
        await unlink(this.root).catch(() => void 0);
      }
    }
    throw new AnvilError("RUN_LOCKED", `Workspace lock changed while acquiring: ${this.root}`);
  }
  async heartbeat() {
    if (!this.held) return;
    const record2 = JSON.parse(await readFile3(this.root, "utf8"));
    record2.heartbeatAt = (/* @__PURE__ */ new Date()).toISOString();
    const temporary = `${this.root}.${process.pid}.tmp`;
    await writeFile2(temporary, JSON.stringify(record2, null, 2));
    await rename2(temporary, this.root);
  }
  async release() {
    if (!this.held) return;
    _WorkspaceLock.active.delete(this.root);
    this.held = false;
    try {
      await unlink(this.root);
    } catch {
    }
  }
};

// src/git/revision.ts
import { execFileSync } from "node:child_process";
import { readFile as readFile4 } from "node:fs/promises";
import path6 from "node:path";
var GitRevisionProvider = class {
  root;
  options;
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
  }
  async current() {
    const head = this.git([
      "rev-parse",
      "HEAD"
    ]).trim();
    const staged = this.gitBytes([
      "diff",
      "--cached",
      "--binary",
      "--no-ext-diff"
    ]);
    const unstaged = this.gitBytes([
      "diff",
      "--binary",
      "--no-ext-diff"
    ]);
    const untracked = this.git([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z"
    ]).split("\0").filter(Boolean).filter((file) => !this.isIgnored(file)).sort();
    const hashes = [];
    for (const relative of untracked) hashes.push({
      path: relative,
      sha256: sha256(new Uint8Array(await readFile4(path6.join(this.root, relative))))
    });
    const id = `wr1:${sha256(JSON.stringify({
      version: 1,
      head,
      stagedSha256: sha256(staged),
      unstagedSha256: sha256(unstaged),
      untracked: hashes
    }))}`;
    return {
      id,
      head,
      stagedSha256: sha256(staged),
      unstagedSha256: sha256(unstaged),
      untracked
    };
  }
  async changedFiles(from, to) {
    if (from === to) return [];
    return this.git([
      "diff",
      "--name-only",
      "--no-ext-diff",
      "HEAD"
    ]).split(/\r?\n/).filter(Boolean).filter((file) => !this.isIgnored(file));
  }
  isIgnored(file) {
    return [
      ".omp/.anvil/",
      ...this.options.ignore ?? []
    ].some((prefix) => prefix.endsWith("/**") ? file.startsWith(prefix.slice(0, -3)) : file === prefix || file.startsWith(prefix));
  }
  git(args) {
    try {
      return execFileSync("git", [
        "-C",
        this.root,
        ...args
      ], {
        encoding: "utf8"
      });
    } catch (error) {
      const detail = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
      throw new AnvilError("WORKSPACE_NOT_GIT", detail.trim() || "Git command failed", error);
    }
  }
  gitBytes(args) {
    try {
      const output = execFileSync("git", [
        "-C",
        this.root,
        ...args
      ], {
        encoding: "buffer"
      });
      return new Uint8Array(output);
    } catch (error) {
      const detail = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
      throw new AnvilError("WORKSPACE_NOT_GIT", detail.trim() || "Git command failed", error);
    }
  }
};

// src/runners/process.ts
import { spawn } from "node:child_process";
async function runProcess(command, input) {
  const started = Date.now();
  const stdoutChunks = [];
  const stderrChunks = [];
  let timedOut = false;
  try {
    const child = spawn(command[0], command.slice(1), {
      cwd: input.cwd,
      env: input.env ? {
        ...process.env,
        ...input.env
      } : process.env,
      stdio: [
        "ignore",
        "pipe",
        "pipe"
      ]
    });
    child.stdout.on("data", (chunk) => stdoutChunks.push(new Uint8Array(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(new Uint8Array(chunk)));
    const abort = () => child.kill("SIGKILL");
    input.signal?.addEventListener("abort", abort, {
      once: true
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
    const stdout = new TextDecoder().decode(concat(stdoutChunks));
    const stderr = new TextDecoder().decode(concat(stderrChunks));
    if (input.signal?.aborted) return {
      status: "error",
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - started
    };
    if (timedOut) return {
      status: "timed_out",
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - started
    };
    return {
      status: exitCode === 0 ? "passed" : "failed",
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - started
    };
  } catch (error) {
    return {
      status: "error",
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started
    };
  }
}
function concat(chunks) {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

// src/runners/check-runner.ts
var DeterministicCheckRunner = class {
  artifacts;
  constructor(artifacts) {
    this.artifacts = artifacts;
  }
  async run(check, input) {
    const result = await runProcess(check.command, {
      cwd: check.cwd ?? input.cwd,
      env: check.env,
      timeoutMs: check.timeoutMs,
      signal: input.signal
    });
    const stdout = input.runId && this.artifacts ? await this.artifacts.putText(input.runId, "check-stdout", `logs/check-${check.id}-${input.epoch ?? 0}.stdout`, result.stdout) : void 0;
    const stderr = input.runId && this.artifacts ? await this.artifacts.putText(input.runId, "check-stderr", `logs/check-${check.id}-${input.epoch ?? 0}.stderr`, result.stderr) : void 0;
    const highlights = (result.stderr || result.stdout).split(/\r?\n/).filter((line) => /error|fail|assert|✗/i.test(line)).slice(0, 8);
    return {
      id: check.id,
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdoutArtifact: stdout,
      stderrArtifact: stderr,
      summary: result.status === "passed" ? `${check.id} passed` : boundedText(highlights.join(" | ") || `${check.id} exited ${result.exitCode ?? "with an error"}`, 800)
    };
  }
};

// src/runners/omp-subprocess-runner.ts
var OmpSubprocessRunner = class {
  compat;
  constructor(compat) {
    this.compat = compat;
  }
  async validate(cwd, names) {
    if (!this.compat.discoverAgents) return;
    const discovered = await this.compat.discoverAgents(cwd);
    const namesByValue = new Set(discovered.filter((agent) => !agent.disabled).map((agent) => agent.name));
    const missing = names.filter((name) => !namesByValue.has(name));
    if (missing.length > 0) throw new AnvilError("AGENT_NOT_FOUND", `Configured agents were not discovered: ${missing.join(", ")}`);
  }
  async run(request) {
    if (!this.compat.execute) return {
      status: "failed",
      agentName: request.agentName,
      usage: {
        requests: 0
      },
      durationMs: 0,
      error: {
        code: "OMP_EXECUTOR_UNAVAILABLE",
        message: "No OMP child-agent executor is available in this extension context"
      }
    };
    return this.compat.execute(request);
  }
};

// src/runners/omp-compat.ts
function createOmpCompat(context) {
  const candidate = context;
  return {
    discoverAgents: candidate.discoverAgents,
    execute: candidate.runSubprocess
  };
}

// src/memory/adapter.ts
var OptionalMemoryAdapter = class {
  runtime;
  constructor(runtime) {
    this.runtime = runtime;
  }
  async recall(_role, query, options) {
    if (!this.runtime) return [];
    try {
      const result = await this.runtime.search(query, {
        limit: options.limit,
        signal: options.signal
      });
      let remaining = options.maxChars;
      return (result.items ?? []).filter((item) => {
        if (remaining <= 0) return false;
        remaining -= item.content.length;
        return remaining >= 0;
      });
    } catch {
      return [];
    }
  }
  async retain(lessons, run) {
    if (!this.runtime) return;
    for (const lesson of lessons.slice(0, 3)) {
      if (!lesson.content.trim() || lesson.content.length > 2e3) continue;
      if (/api[_-]?key|secret|password|token/i.test(lesson.content)) continue;
      await this.runtime.save({
        content: lesson.content,
        context: `Anvil successful run ${run.id}`,
        source: "omp-anvil",
        importance: lesson.importance
      });
    }
  }
};

// src/workflow/engine.ts
import path7 from "node:path";

// src/config/hash.ts
function configHash(config) {
  return hashJson(config);
}

// src/context/serializers.ts
function serializeHandoff(envelope, maxChars) {
  const required = {
    version: envelope.version,
    runId: envelope.runId,
    role: envelope.role,
    mutationEpoch: envelope.mutationEpoch,
    revisionId: envelope.revisionId,
    objective: envelope.objective,
    plan: envelope.plan,
    constraints: envelope.constraints
  };
  const optional = {
    activePlanSteps: envelope.activePlanSteps,
    acceptance: envelope.acceptance,
    openFindings: envelope.openFindings,
    evidence: envelope.evidence,
    memory: envelope.memory,
    changedFiles: envelope.changedFiles
  };
  let rendered = stableJson({
    ...required,
    ...optional
  });
  if (rendered.length <= maxChars) return rendered;
  const reduced = {
    ...required,
    acceptance: envelope.acceptance,
    openFindings: envelope.openFindings?.map(({ id, source, severity, title, artifact }) => ({
      id,
      source,
      severity,
      title,
      artifact
    })),
    changedFiles: envelope.changedFiles?.slice(0, 50)
  };
  rendered = stableJson(reduced);
  return rendered.length <= maxChars ? rendered : boundedText(rendered, maxChars);
}

// src/context/builder.ts
var ContextBuilder = class {
  config;
  constructor(config) {
    this.config = config;
  }
  build(role, input) {
    const envelope = {
      version: 1,
      runId: input.run.id,
      role,
      mutationEpoch: input.run.mutationEpoch,
      revisionId: input.run.currentRevisionId,
      objective: input.objective,
      plan: input.plan,
      activePlanSteps: void 0,
      acceptance: input.acceptance,
      changedFiles: input.changedFiles?.slice(0, this.config.context.maxChangedFiles),
      openFindings: input.findings?.map((finding) => ({
        id: finding.id,
        source: finding.sourceGate,
        severity: finding.severity,
        title: finding.title,
        location: finding.filePath ? `${finding.filePath}:${finding.lineStart ?? "?"}` : void 0,
        artifact: finding.evidenceArtifactId ? {
          id: finding.evidenceArtifactId,
          path: "artifacts/finding.json",
          sha256: ""
        } : input.objective
      })),
      evidence: input.evidence,
      memory: input.memory?.slice(0, this.config.context.maxMemoryItems),
      constraints: {
        maxInlineChars: this.config.context.maxInlineChars,
        readOnly: role === "security" || role === "review" || role === "planner",
        noTranscript: true
      }
    };
    return {
      envelope,
      text: serializeHandoff(envelope, this.config.context.maxInlineChars)
    };
  }
};

// src/findings/fingerprint.ts
function normalizeFindingInput(input) {
  return {
    sourceGate: input.sourceGate,
    category: input.category.trim().toLowerCase(),
    file: input.file?.replaceAll("\\", "/").trim().toLowerCase(),
    symbol: input.symbol?.trim().toLowerCase(),
    title: input.title.replace(/\bline\s+\d+\b/gi, "line").replace(/\s+/g, " ").replace(/[.!,;:]+$/g, "").trim().toLowerCase()
  };
}
function findingFingerprint(input) {
  return hashJson(JSON.parse(stableJson(normalizeFindingInput(input))));
}

// src/findings/lifecycle.ts
var FindingLifecycle = class {
  findings;
  constructor(findings) {
    this.findings = findings;
  }
  upsert(runId, sourceGate, epoch, attempt, incoming) {
    return this.findings.upsert({
      runId,
      sourceGate,
      fingerprint: findingFingerprint({
        sourceGate,
        category: incoming.category,
        file: incoming.file,
        symbol: incoming.symbol,
        title: incoming.title
      }),
      severity: incoming.severity,
      category: incoming.category,
      title: incoming.title,
      description: incoming.description,
      fixRequirement: incoming.fixRequirement,
      filePath: incoming.file,
      lineStart: incoming.lineStart,
      lineEnd: incoming.lineEnd,
      firstSeenEpoch: epoch,
      lastSeenEpoch: epoch,
      firstAttemptId: attempt.id,
      lastAttemptId: attempt.id,
      evidenceArtifactId: incoming.evidenceArtifactId
    });
  }
  resolve(sourceGate, runId, attemptId) {
    this.findings.resolveGate(runId, sourceGate, attemptId);
  }
};

// src/agents/roles.ts
var ROLE_LABELS = {
  planner: "Architect",
  implementation: "Smith",
  security: "Sentinel",
  review: "Inquisitor"
};
var MODEL_ROLE_ALIASES = {
  planner: "architect",
  implementation: "smith",
  security: "sentinel",
  review: "inquisitor"
};
var WORKFLOW_ROLE_ORDER = [
  "planner",
  "implementation",
  "security",
  "review"
];

// src/budget/ledger.ts
var BudgetManager = class {
  config;
  constructor(config) {
    this.config = config;
  }
  assertMayContinue(run) {
    const limits = this.config.budgets;
    if (limits.maxTotalTokens !== void 0 && run.usedTokens >= limits.maxTotalTokens) throw new AnvilError("BUDGET_EXHAUSTED", "Total token budget exhausted");
    if (limits.maxTotalRequests !== void 0 && run.usedRequests >= limits.maxTotalRequests) throw new AnvilError("BUDGET_EXHAUSTED", "Total request budget exhausted");
    if (limits.maxTransitions !== void 0 && run.transitionCount >= limits.maxTransitions) throw new AnvilError("BUDGET_EXHAUSTED", "Workflow transition budget exhausted");
    if (limits.maxWallClockMs !== void 0 && Date.now() - Date.parse(run.startedAt ?? run.createdAt) >= limits.maxWallClockMs) throw new AnvilError("BUDGET_EXHAUSTED", "Workflow wall-clock budget exhausted");
  }
  assertRoleMayRun(_run, role, attempts, roleTokens = 0) {
    const rolePolicy = this.config.budgets.perRole[role];
    if (rolePolicy?.maxAttempts !== void 0 && attempts >= rolePolicy.maxAttempts) throw new AnvilError("MAX_ATTEMPTS_EXCEEDED", `${ROLE_LABELS[role]} attempt budget exhausted`);
    if (rolePolicy?.maxTokens !== void 0 && roleTokens >= rolePolicy.maxTokens) throw new AnvilError("BUDGET_EXHAUSTED", `${ROLE_LABELS[role]} token budget exhausted`);
  }
};

// src/workflow/invariants.ts
async function assertCanComplete(run, deps) {
  const current = await deps.revisions.current();
  if (current.id !== run.currentRevisionId) throw new AnvilError("INVARIANT_VIOLATION", "Workspace revision changed before completion");
  for (const [gate, policyHash] of [
    [
      "checks",
      JSON.stringify(deps.config.checks)
    ],
    [
      "security",
      JSON.stringify(deps.config.security)
    ],
    [
      "review",
      JSON.stringify(deps.config.review)
    ]
  ]) {
    const passing = deps.gates.currentPass(run.id, gate, current.id, run.configHash, policyHash);
    if (!passing) throw new AnvilError("INVARIANT_VIOLATION", `${gate} has no passing result for the exact current revision`);
  }
  const blocking = deps.findings.list(run.id, "open").filter((finding) => deps.config.security.failOn.includes(finding.severity) || deps.config.review.blockOn.includes(finding.severity));
  if (blocking.length > 0) throw new AnvilError("INVARIANT_VIOLATION", "Blocking findings remain open");
}

// src/workflow/transitions.ts
var LEGAL = {
  INIT: [
    "PLAN",
    "FAILED",
    "CANCELLED"
  ],
  PLAN: [
    "IMPLEMENT",
    "PLAN",
    "BLOCKED",
    "FAILED",
    "CANCELLED"
  ],
  IMPLEMENT: [
    "CHECKS",
    "PLAN",
    "BLOCKED",
    "FAILED",
    "CANCELLED"
  ],
  CHECKS: [
    "SECURITY",
    "IMPLEMENT",
    "BLOCKED",
    "FAILED",
    "CANCELLED"
  ],
  SECURITY: [
    "REVIEW",
    "IMPLEMENT",
    "CHECKS",
    "BLOCKED",
    "FAILED",
    "CANCELLED"
  ],
  REVIEW: [
    "DONE",
    "IMPLEMENT",
    "CHECKS",
    "BLOCKED",
    "FAILED",
    "CANCELLED"
  ],
  DONE: [],
  BLOCKED: [],
  FAILED: [],
  CANCELLED: []
};
function assertLegalTransition(from, to) {
  if (!LEGAL[from].includes(to)) throw new AnvilError("INVARIANT_VIOLATION", `Illegal workflow transition ${from} -> ${to}`);
}
function nextAfterSecurity(result, failOn) {
  if (result.verdict === "blocked") return "BLOCKED";
  return result.verdict === "findings" && result.findings.some((finding) => failOn.includes(finding.severity)) ? "IMPLEMENT" : "REVIEW";
}
function nextAfterReview(result, blockOn) {
  if (result.verdict === "blocked") return "BLOCKED";
  return result.verdict === "findings" && result.findings.some((finding) => blockOn.includes(finding.severity)) ? "IMPLEMENT" : "DONE";
}

// src/workflow/state.ts
var STATE_LABELS = {
  INIT: "Initializing",
  PLAN: "Architect",
  IMPLEMENT: "Smith",
  CHECKS: "Warden",
  SECURITY: "Sentinel",
  REVIEW: "Inquisitor",
  DONE: "Sealed",
  BLOCKED: "Blocked",
  FAILED: "Failed",
  CANCELLED: "Cancelled"
};
var TERMINAL_STATES = /* @__PURE__ */ new Set([
  "DONE",
  "BLOCKED",
  "FAILED",
  "CANCELLED"
]);
var isTerminal = (state) => TERMINAL_STATES.has(state);
var statusForState = (state) => state === "DONE" ? "done" : state === "BLOCKED" ? "blocked" : state === "FAILED" ? "failed" : state === "CANCELLED" ? "cancelled" : "running";
function displayState(state) {
  return STATE_LABELS[state];
}

// src/state/event-store.ts
var EventStore = class {
  state;
  constructor(state) {
    this.state = state;
  }
  append(event) {
    this.state.db.run("INSERT INTO events(run_id, timestamp, type, actor, state_before, state_after, revision_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      event.runId,
      (/* @__PURE__ */ new Date()).toISOString(),
      event.type,
      event.actor,
      event.stateBefore ?? null,
      event.stateAfter ?? null,
      event.revisionId ?? null,
      JSON.stringify(event.payload ?? {})
    ]);
  }
  list(runId) {
    return this.state.db.query("SELECT * FROM events WHERE run_id = ? ORDER BY seq").all(runId);
  }
};

// src/state/repositories.ts
function now() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function value(row, key) {
  const result = row[key];
  return result === null || result === void 0 ? void 0 : result;
}
function mapRun(row) {
  return {
    id: row.id,
    workflowName: row.workflow_name,
    workflowVersion: row.workflow_version,
    configHash: row.config_hash,
    workspaceRoot: row.workspace_root,
    objectivePath: row.objective_path,
    planPath: value(row, "plan_path"),
    baseRevisionId: row.base_revision_id,
    currentRevisionId: row.current_revision_id,
    mutationEpoch: row.mutation_epoch,
    currentState: row.current_state,
    status: row.status,
    activeAttemptId: value(row, "active_attempt_id"),
    maxTotalTokens: value(row, "max_total_tokens"),
    maxTotalRequests: value(row, "max_total_requests"),
    maxTransitions: value(row, "max_transitions"),
    maxWallClockMs: value(row, "max_wall_clock_ms"),
    usedTokens: row.used_tokens,
    usedInputTokens: row.used_input_tokens,
    usedOutputTokens: row.used_output_tokens,
    usedCacheReadTokens: row.used_cache_read_tokens,
    usedCacheWriteTokens: row.used_cache_write_tokens,
    usedRequests: row.used_requests,
    transitionCount: row.transition_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: value(row, "started_at"),
    finishedAt: value(row, "finished_at"),
    blockedReason: value(row, "blocked_reason"),
    failureCode: value(row, "failure_code"),
    failureMessage: value(row, "failure_message"),
    initialHead: row.initial_head
  };
}
function mapAttempt(row) {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    state: row.state,
    role: value(row, "role"),
    agentName: value(row, "agent_name"),
    modelSelector: value(row, "model_selector"),
    inputArtifactId: value(row, "input_artifact_id"),
    outputArtifactId: value(row, "output_artifact_id"),
    baseRevisionId: row.base_revision_id,
    resultRevisionId: value(row, "result_revision_id"),
    status: row.status,
    verdict: value(row, "verdict"),
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    tokens: row.tokens,
    requests: row.requests,
    contextTokens: value(row, "context_tokens"),
    contextWindow: value(row, "context_window"),
    durationMs: value(row, "duration_ms"),
    startedAt: row.started_at,
    endedAt: value(row, "ended_at"),
    errorCode: value(row, "error_code"),
    errorMessage: value(row, "error_message")
  };
}
function mapGate(row) {
  return {
    id: row.id,
    runId: row.run_id,
    gate: row.gate,
    revisionId: row.revision_id,
    mutationEpoch: row.mutation_epoch,
    configHash: row.config_hash,
    gatePolicyHash: row.gate_policy_hash,
    verdict: row.verdict,
    attemptId: value(row, "attempt_id"),
    artifactId: value(row, "artifact_id"),
    startedAt: row.started_at,
    endedAt: row.ended_at
  };
}
function mapFinding(row) {
  return {
    id: row.id,
    runId: row.run_id,
    sourceGate: row.source_gate,
    fingerprint: row.fingerprint,
    severity: row.severity,
    category: row.category,
    title: row.title,
    description: row.description,
    fixRequirement: value(row, "fix_requirement"),
    filePath: value(row, "file_path"),
    lineStart: value(row, "line_start"),
    lineEnd: value(row, "line_end"),
    status: row.status,
    firstSeenEpoch: row.first_seen_epoch,
    lastSeenEpoch: row.last_seen_epoch,
    timesSeen: row.times_seen,
    reopenCount: row.reopen_count,
    firstAttemptId: row.first_attempt_id,
    lastAttemptId: row.last_attempt_id,
    evidenceArtifactId: value(row, "evidence_artifact_id"),
    resolvedAttemptId: value(row, "resolved_attempt_id"),
    resolutionNote: value(row, "resolution_note"),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
var RunRepository = class {
  state;
  events;
  constructor(state, events = new EventStore(state)) {
    this.state = state;
    this.events = events;
  }
  create(input) {
    const timestamp = now();
    const run = {
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "running",
      currentState: "INIT",
      usedTokens: 0,
      usedInputTokens: 0,
      usedOutputTokens: 0,
      usedCacheReadTokens: 0,
      usedCacheWriteTokens: 0,
      usedRequests: 0,
      transitionCount: 0
    };
    this.state.db.run("INSERT INTO runs(id, workflow_name, workflow_version, config_hash, workspace_root, objective_path, plan_path, base_revision_id, current_revision_id, mutation_epoch, current_state, status, max_total_tokens, max_total_requests, max_transitions, max_wall_clock_ms, created_at, updated_at, started_at, initial_head) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      run.id,
      run.workflowName,
      run.workflowVersion,
      run.configHash,
      run.workspaceRoot,
      run.objectivePath,
      run.planPath ?? null,
      run.baseRevisionId,
      run.currentRevisionId,
      0,
      "INIT",
      "running",
      run.maxTotalTokens ?? null,
      run.maxTotalRequests ?? null,
      run.maxTransitions ?? null,
      run.maxWallClockMs ?? null,
      timestamp,
      timestamp,
      timestamp,
      run.initialHead
    ]);
    this.events.append({
      runId: run.id,
      type: "RUN_CREATED",
      actor: "anvil",
      stateAfter: "INIT",
      revisionId: run.currentRevisionId
    });
    return run;
  }
  require(id) {
    const row = this.state.db.query("SELECT * FROM runs WHERE id = ?").get(id);
    if (!row) throw new AnvilError("RUN_NOT_FOUND", `Run not found: ${id}`);
    return mapRun(row);
  }
  latest() {
    const row = this.state.db.query("SELECT * FROM runs ORDER BY created_at DESC LIMIT 1").get();
    return row ? mapRun(row) : void 0;
  }
  update(id, patch, event) {
    const allowed = /* @__PURE__ */ new Set([
      "plan_path",
      "current_revision_id",
      "mutation_epoch",
      "current_state",
      "status",
      "active_attempt_id",
      "used_tokens",
      "used_input_tokens",
      "used_output_tokens",
      "used_cache_read_tokens",
      "used_cache_write_tokens",
      "used_requests",
      "transition_count",
      "updated_at",
      "started_at",
      "finished_at",
      "blocked_reason",
      "failure_code",
      "failure_message"
    ]);
    const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
    if (entries.length > 0) {
      const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
      this.state.db.run(`UPDATE runs SET ${assignments}, updated_at = ? WHERE id = ?`, [
        ...entries.map(([, field]) => field),
        now(),
        id
      ]);
    }
    if (event) this.events.append({
      runId: id,
      actor: event.actor ?? "anvil",
      ...event
    });
    return this.require(id);
  }
  beginAttempt(run, state, role, agentName) {
    const row = this.state.db.query("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM attempts WHERE run_id = ?").get(run.id);
    const attempt = {
      id: `att_${crypto.randomUUID()}`,
      runId: run.id,
      sequence: row?.sequence ?? 1,
      state,
      role,
      agentName,
      baseRevisionId: run.currentRevisionId,
      status: "running",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      tokens: 0,
      requests: 0,
      startedAt: now()
    };
    this.state.db.run("INSERT INTO attempts(id, run_id, sequence, state, role, agent_name, base_revision_id, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      attempt.id,
      run.id,
      attempt.sequence,
      state,
      role ?? null,
      agentName,
      run.currentRevisionId,
      "running",
      attempt.startedAt
    ]);
    this.update(run.id, {
      active_attempt_id: attempt.id
    });
    return attempt;
  }
  finalizeAttempt(attempt, result) {
    const usage = result.usage ?? {};
    const tokens = usage.total ?? (usage.input ?? 0) + (usage.output ?? 0);
    this.state.db.run("UPDATE attempts SET status = ?, result_revision_id = ?, verdict = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?, tokens = ?, requests = ?, context_tokens = ?, context_window = ?, duration_ms = ?, ended_at = ?, error_code = ?, error_message = ? WHERE id = ?", [
      result.status,
      result.resultRevisionId ?? null,
      result.verdict ?? null,
      usage.input ?? 0,
      usage.output ?? 0,
      usage.cacheRead ?? 0,
      usage.cacheWrite ?? 0,
      tokens,
      usage.requests ?? 0,
      usage.contextTokens ?? null,
      usage.contextWindow ?? null,
      result.durationMs ?? null,
      now(),
      result.error?.code ?? null,
      result.error?.message ?? null,
      attempt.id
    ]);
    const run = this.require(attempt.runId);
    this.update(run.id, {
      active_attempt_id: null,
      used_tokens: run.usedTokens + tokens,
      used_input_tokens: run.usedInputTokens + (usage.input ?? 0),
      used_output_tokens: run.usedOutputTokens + (usage.output ?? 0),
      used_cache_read_tokens: run.usedCacheReadTokens + (usage.cacheRead ?? 0),
      used_cache_write_tokens: run.usedCacheWriteTokens + (usage.cacheWrite ?? 0),
      used_requests: run.usedRequests + (usage.requests ?? 0)
    });
  }
  attempts(runId) {
    return this.state.db.query("SELECT * FROM attempts WHERE run_id = ? ORDER BY sequence").all(runId).map(mapAttempt);
  }
  attemptsFor(runId, state) {
    return this.attempts(runId).filter((attempt) => attempt.state === state);
  }
  markRunningInterrupted(runId) {
    const attempt = this.attempts(runId).find((item) => item.status === "running");
    if (!attempt) return void 0;
    this.state.db.run("UPDATE attempts SET status = 'interrupted', ended_at = ? WHERE id = ?", [
      now(),
      attempt.id
    ]);
    return {
      ...attempt,
      status: "interrupted",
      endedAt: now()
    };
  }
};
var GateRepository = class {
  state;
  constructor(state) {
    this.state = state;
  }
  save(input) {
    const result = {
      ...input,
      id: `gate_${crypto.randomUUID()}`
    };
    this.state.db.run("INSERT OR REPLACE INTO gate_results(id, run_id, gate, revision_id, mutation_epoch, config_hash, gate_policy_hash, verdict, attempt_id, artifact_id, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      result.id,
      result.runId,
      result.gate,
      result.revisionId,
      result.mutationEpoch,
      result.configHash,
      result.gatePolicyHash,
      result.verdict,
      result.attemptId ?? null,
      result.artifactId ?? null,
      result.startedAt,
      result.endedAt
    ]);
    return result;
  }
  latestPassing(runId, gate) {
    const row = this.state.db.query("SELECT * FROM gate_results WHERE run_id = ? AND gate = ? AND verdict = 'pass' ORDER BY ended_at DESC LIMIT 1").get(runId, gate);
    return row ? mapGate(row) : void 0;
  }
  currentPass(runId, gate, revisionId, configHash2, policyHash) {
    const row = this.state.db.query("SELECT * FROM gate_results WHERE run_id = ? AND gate = ? AND revision_id = ? AND config_hash = ? AND gate_policy_hash = ? AND verdict = 'pass' ORDER BY ended_at DESC LIMIT 1").get(runId, gate, revisionId, configHash2, policyHash);
    return row ? mapGate(row) : void 0;
  }
};
var FindingRepository = class {
  state;
  constructor(state) {
    this.state = state;
  }
  list(runId, status) {
    const rows = status ? this.state.db.query("SELECT * FROM findings WHERE run_id = ? AND status = ? ORDER BY created_at").all(runId, status) : this.state.db.query("SELECT * FROM findings WHERE run_id = ? ORDER BY created_at").all(runId);
    return rows.map(mapFinding);
  }
  hasBlocking(runId, blocking) {
    const findings = this.list(runId, "open");
    return findings.some((finding) => blocking.includes(finding.severity));
  }
  upsert(input) {
    const existing = this.state.db.query("SELECT * FROM findings WHERE run_id = ? AND source_gate = ? AND fingerprint = ?").get(input.runId, input.sourceGate, input.fingerprint);
    const timestamp = now();
    if (!existing) {
      const finding = {
        ...input,
        id: `${input.sourceGate.slice(0, 3).toUpperCase()}-${String(this.list(input.runId).length + 1).padStart(4, "0")}`,
        status: "open",
        timesSeen: 1,
        reopenCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      this.state.db.run("INSERT INTO findings(id, run_id, source_gate, fingerprint, severity, category, title, description, fix_requirement, file_path, line_start, line_end, status, first_seen_epoch, last_seen_epoch, times_seen, reopen_count, first_attempt_id, last_attempt_id, evidence_artifact_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        finding.id,
        finding.runId,
        finding.sourceGate,
        finding.fingerprint,
        finding.severity,
        finding.category,
        finding.title,
        finding.description,
        finding.fixRequirement ?? null,
        finding.filePath ?? null,
        finding.lineStart ?? null,
        finding.lineEnd ?? null,
        finding.status,
        finding.firstSeenEpoch,
        finding.lastSeenEpoch,
        1,
        0,
        finding.firstAttemptId,
        finding.lastAttemptId,
        finding.evidenceArtifactId ?? null,
        timestamp,
        timestamp
      ]);
      return finding;
    }
    const prior = mapFinding(existing);
    const reopened = prior.status === "resolved";
    this.state.db.run("UPDATE findings SET severity = ?, description = ?, fix_requirement = ?, file_path = ?, line_start = ?, line_end = ?, status = 'open', last_seen_epoch = ?, times_seen = ?, reopen_count = ?, last_attempt_id = ?, evidence_artifact_id = ?, updated_at = ? WHERE id = ?", [
      input.severity,
      input.description,
      input.fixRequirement ?? null,
      input.filePath ?? null,
      input.lineStart ?? null,
      input.lineEnd ?? null,
      input.lastSeenEpoch,
      prior.timesSeen + 1,
      prior.reopenCount + (reopened ? 1 : 0),
      input.lastAttemptId,
      input.evidenceArtifactId ?? null,
      timestamp,
      prior.id
    ]);
    return {
      ...prior,
      ...input,
      status: "open",
      timesSeen: prior.timesSeen + 1,
      reopenCount: prior.reopenCount + (reopened ? 1 : 0),
      updatedAt: timestamp
    };
  }
  resolveGate(runId, sourceGate, attemptId) {
    this.state.db.run("UPDATE findings SET status = 'resolved', resolved_attempt_id = ?, resolution_note = ?, updated_at = ? WHERE run_id = ? AND source_gate = ? AND status = 'open'", [
      attemptId,
      "Full gate pass on current revision",
      now(),
      runId,
      sourceGate
    ]);
  }
};

// src/schemas/validate.ts
function requirePlan(value2) {
  const plan = value2;
  if (!plan || plan.version !== 1 || !plan.summary || !Array.isArray(plan.steps) || plan.steps.length === 0 || !Array.isArray(plan.globalAcceptanceCriteria) || plan.globalAcceptanceCriteria.length === 0) throw new AnvilError("SCHEMA_INVALID", "Architect output does not match PlanOutput");
  const ids = /* @__PURE__ */ new Set();
  for (const step of plan.steps) {
    if (!step.id || ids.has(step.id) || !step.objective || !Array.isArray(step.acceptanceCriteria) || step.acceptanceCriteria.length === 0) throw new AnvilError("SCHEMA_INVALID", "Architect step is invalid");
    ids.add(step.id);
  }
  for (const step of plan.steps) for (const dependency of step.dependsOn) if (!ids.has(dependency)) throw new AnvilError("SCHEMA_INVALID", `Architect dependency ${dependency} does not exist`);
  return plan;
}
function requireImplementation(value2) {
  const output = value2;
  if (!output || output.version !== 1 || ![
    "completed",
    "blocked",
    "needs_replan"
  ].includes(output.status) || typeof output.summary !== "string" || !Array.isArray(output.claimedChangedFiles)) throw new AnvilError("SCHEMA_INVALID", "Smith output does not match ImplementationOutput");
  return output;
}
function requireSecurity(value2) {
  const output = value2;
  if (!output || output.version !== 1 || ![
    "pass",
    "findings",
    "blocked"
  ].includes(output.verdict) || !output.scope || !Array.isArray(output.findings)) throw new AnvilError("SCHEMA_INVALID", "Sentinel output does not match SecurityOutput");
  if (output.verdict === "findings" && output.findings.length === 0) throw new AnvilError("SCHEMA_INVALID", "Sentinel findings verdict requires findings");
  if (output.verdict === "blocked" && !output.blockedReason) throw new AnvilError("SCHEMA_INVALID", "Blocked Sentinel output requires blockedReason");
  return output;
}
function requireReview(value2) {
  const output = value2;
  if (!output || output.version !== 1 || ![
    "pass",
    "findings",
    "blocked"
  ].includes(output.verdict) || !Array.isArray(output.acceptance) || !Array.isArray(output.findings)) throw new AnvilError("SCHEMA_INVALID", "Inquisitor output does not match ReviewOutput");
  if (output.verdict === "blocked" && !output.blockedReason) throw new AnvilError("SCHEMA_INVALID", "Blocked Inquisitor output requires blockedReason");
  return output;
}

// src/workflow/engine.ts
var SYSTEM_CLOCK = {
  now: () => /* @__PURE__ */ new Date()
};
var WorkflowEngine = class {
  deps;
  runs;
  gates;
  findings;
  events;
  context;
  budget;
  lifecycle;
  clock;
  objectivePointers;
  lessons;
  controllers;
  constructor(deps) {
    this.deps = deps;
    this.objectivePointers = /* @__PURE__ */ new Map();
    this.lessons = /* @__PURE__ */ new Map();
    this.controllers = /* @__PURE__ */ new Map();
    this.runs = new RunRepository(deps.state);
    this.gates = new GateRepository(deps.state);
    this.findings = new FindingRepository(deps.state);
    this.events = new EventStore(deps.state);
    this.context = new ContextBuilder(deps.config);
    this.budget = new BudgetManager(deps.config);
    this.lifecycle = new FindingLifecycle(this.findings);
    this.clock = deps.clock ?? SYSTEM_CLOCK;
  }
  async start(input) {
    const objective = input.objective.trim();
    if (!objective) throw new AnvilError("CONFIG_INVALID", "Objective cannot be empty");
    const revision = await this.deps.revisions.current();
    const runId = `run_${crypto.randomUUID()}`;
    const run = this.runs.create({
      id: runId,
      workflowName: this.deps.config.workflow.name,
      workflowVersion: 1,
      configHash: configHash(this.deps.config),
      workspaceRoot: input.workspaceRoot,
      objectivePath: path7.join("runs", runId, "objective.md"),
      baseRevisionId: revision.id,
      currentRevisionId: revision.id,
      mutationEpoch: 0,
      initialHead: revision.head,
      maxTotalTokens: this.deps.config.budgets.maxTotalTokens,
      maxTotalRequests: this.deps.config.budgets.maxTotalRequests,
      maxTransitions: this.deps.config.budgets.maxTransitions,
      maxWallClockMs: this.deps.config.budgets.maxWallClockMs
    });
    const pointer = await this.deps.artifacts.putText(run.id, "objective", "objective.md", objective, "text/markdown");
    this.objectivePointers.set(run.id, pointer);
    await this.deps.artifacts.putJson(run.id, "config", "effective-config.json", this.deps.config);
    const started = this.transition(run, "PLAN", "RUN_STARTED", {
      objective: pointer.path
    });
    this.controllers.set(run.id, new AbortController());
    try {
      return await this.drive(started, this.controllers.get(run.id).signal);
    } finally {
      this.controllers.delete(run.id);
    }
  }
  async resume(runId) {
    let run = this.runs.require(runId);
    if (isTerminal(run.currentState)) return this.summary(run);
    this.runs.markRunningInterrupted(runId);
    const current = await this.deps.revisions.current();
    const changedDuringImplementation = run.currentState === "IMPLEMENT" && current.id !== run.currentRevisionId;
    if (changedDuringImplementation) {
      run = this.updateRevision(run, current.id, "IMPLEMENTATION_INTERRUPTED_WITH_CHANGES");
      run = this.transition(run, "CHECKS", "IMPLEMENTATION_INTERRUPTED_WITH_CHANGES", {
        revisionId: current.id
      });
    }
    this.controllers.set(runId, new AbortController());
    try {
      return await this.drive(this.runs.require(runId), this.controllers.get(runId).signal);
    } finally {
      this.controllers.delete(runId);
    }
  }
  async cancel(runId) {
    const controller = this.controllers.get(runId);
    controller?.abort();
    const run = this.runs.require(runId);
    if (!isTerminal(run.currentState)) this.transition(run, "CANCELLED", "RUN_CANCELLED");
  }
  status(runId) {
    const run = runId ? this.runs.require(runId) : this.runs.latest();
    if (!run) throw new AnvilError("RUN_NOT_FOUND", "No Anvil runs exist");
    return this.summary(run);
  }
  async drive(initial, signal) {
    let run = initial;
    while (!isTerminal(run.currentState)) {
      try {
        this.budget.assertMayContinue(run);
      } catch (error) {
        run = this.block(run, asAnvilError(error, "BUDGET_EXHAUSTED"));
        break;
      }
      if (signal.aborted) {
        run = this.transition(run, "CANCELLED", "RUN_CANCELLED");
        break;
      }
      try {
        switch (run.currentState) {
          case "PLAN":
            run = await this.executePlan(run, signal);
            break;
          case "IMPLEMENT":
            run = await this.executeImplementation(run, signal);
            break;
          case "CHECKS":
            run = await this.executeChecks(run, signal);
            break;
          case "SECURITY":
            run = await this.executeSecurity(run, signal);
            break;
          case "REVIEW":
            run = await this.executeReview(run, signal);
            break;
          default:
            throw new AnvilError("INVARIANT_VIOLATION", `Cannot drive state ${run.currentState}`);
        }
      } catch (error) {
        const typed = asAnvilError(error);
        run = typed.code === "BUDGET_EXHAUSTED" || typed.code === "MAX_ATTEMPTS_EXCEEDED" ? this.block(run, typed) : this.fail(run, typed);
      }
    }
    return this.summary(run);
  }
  async executePlan(run, signal) {
    const plannerAttempts = this.runs.attemptsFor(run.id, "PLAN");
    this.budget.assertRoleMayRun(run, "planner", plannerAttempts.length, plannerAttempts.reduce((total, attempt2) => total + attempt2.tokens, 0));
    const before = await this.deps.revisions.current();
    if (before.id !== run.currentRevisionId) return this.updateRevision(run, before.id, "PLAN_EXTERNAL_MUTATION");
    const attempt = this.runs.beginAttempt(run, "PLAN", "planner", this.deps.config.agents.planner.agent);
    const handoff = this.context.build("planner", {
      run,
      objective: this.objective(run),
      acceptance: []
    });
    await this.deps.artifacts.putJson(run.id, "handoff", `artifacts/planner/handoff-${attempt.sequence}.json`, handoff.envelope, attempt.id);
    const result = await this.deps.agents.run({
      runId: run.id,
      attemptId: attempt.id,
      role: "planner",
      agentName: this.deps.config.agents.planner.agent,
      assignment: "Produce the strict PlanOutput for this objective.",
      context: handoff.text,
      outputSchema: {
        name: "PlanOutput",
        version: 1
      },
      schemaMode: "strict",
      cwd: run.workspaceRoot,
      baseRevisionId: run.currentRevisionId,
      readOnly: true,
      signal
    });
    const after = await this.deps.revisions.current();
    this.runs.finalizeAttempt(attempt, {
      ...result,
      resultRevisionId: after.id
    });
    if (after.id !== run.currentRevisionId) throw new AnvilError("READ_ONLY_GATE_MUTATED_WORKSPACE", "Architect mutated the workspace");
    if (result.status !== "completed") throw new AnvilError("AGENT_EXECUTION_FAILED", result.error?.message ?? "Architect failed");
    const plan = requirePlan(result.structured);
    const planPointer = await this.deps.artifacts.putJson(run.id, "plan", "plan.json", plan, attempt.id);
    const updated = this.runs.update(run.id, {
      plan_path: planPointer.path
    });
    return this.transition(updated, "IMPLEMENT", "PLAN_COMPLETED", {
      plan: planPointer.path
    });
  }
  async executeImplementation(run, signal) {
    const implementationAttempts = this.runs.attemptsFor(run.id, "IMPLEMENT");
    this.budget.assertRoleMayRun(run, "implementation", implementationAttempts.length, implementationAttempts.reduce((total, attempt2) => total + attempt2.tokens, 0));
    const before = await this.deps.revisions.current();
    if (before.id !== run.currentRevisionId) return this.mutation(run, before.id, "EXTERNAL_WORKSPACE_MUTATION");
    const attempt = this.runs.beginAttempt(run, "IMPLEMENT", "implementation", this.deps.config.agents.implementation.agent);
    const open2 = this.findings.list(run.id, "open");
    const handoff = this.context.build("implementation", {
      run,
      objective: this.objective(run),
      plan: run.planPath ? {
        id: "plan",
        path: run.planPath,
        sha256: ""
      } : void 0,
      findings: open2,
      changedFiles: await this.deps.revisions.changedFiles(run.baseRevisionId, run.currentRevisionId)
    });
    await this.deps.artifacts.putJson(run.id, "handoff", `artifacts/implementation/handoff-${attempt.sequence}.json`, handoff.envelope, attempt.id);
    const result = await this.deps.agents.run({
      runId: run.id,
      attemptId: attempt.id,
      role: "implementation",
      agentName: this.deps.config.agents.implementation.agent,
      assignment: "Implement the active plan and resolve the referenced open findings.",
      context: handoff.text,
      outputSchema: {
        name: "ImplementationOutput",
        version: 1
      },
      schemaMode: "strict",
      cwd: run.workspaceRoot,
      baseRevisionId: before.id,
      readOnly: false,
      isolation: {
        requested: this.deps.config.implementation.isolation.enabled,
        apply: true,
        merge: this.deps.config.implementation.isolation.merge
      },
      signal
    });
    const after = await this.deps.revisions.current();
    this.runs.finalizeAttempt(attempt, {
      ...result,
      resultRevisionId: after.id
    });
    if (result.status !== "completed") throw new AnvilError("AGENT_EXECUTION_FAILED", result.error?.message ?? "Smith failed");
    let output;
    try {
      output = requireImplementation(result.structured);
    } catch (error) {
      throw asAnvilError(error, "SCHEMA_INVALID");
    }
    if (output.durableLessons?.length) this.lessons.set(run.id, output.durableLessons);
    if (after.id !== before.id) return this.mutation(run, after.id, "IMPLEMENTATION_COMPLETED");
    if (output.status === "blocked") return this.block(run, new AnvilError("AGENT_EXECUTION_FAILED", output.summary));
    if (output.status === "needs_replan") {
      if (this.runs.attemptsFor(run.id, "PLAN").length >= this.deps.config.planning.maxGenerations) return this.block(run, new AnvilError("MAX_ATTEMPTS_EXCEEDED", "Maximum plan generations exceeded"));
      return this.transition(run, "PLAN", "IMPLEMENTATION_REPLAN_REQUESTED", {
        reason: output.replanReason
      });
    }
    return this.transition(run, "CHECKS", "IMPLEMENTATION_COMPLETED", {
      revisionId: run.currentRevisionId
    });
  }
  async executeChecks(run, signal) {
    const before = await this.deps.revisions.current();
    if (before.id !== run.currentRevisionId) return this.mutation(run, before.id, "CHECKS_EXTERNAL_MUTATION");
    const results = [];
    for (const check of this.deps.config.checks) {
      const result = await this.deps.checks.run(check, {
        cwd: run.workspaceRoot,
        signal,
        runId: run.id,
        epoch: run.mutationEpoch
      });
      results.push(result);
      if (check.required && result.status !== "passed" && this.deps.config.checksFailFast) break;
    }
    const after = await this.deps.revisions.current();
    if (after.id !== before.id) return this.mutation(run, after.id, "CHECKS_EXTERNAL_MUTATION");
    const artifact = await this.deps.artifacts.putJson(run.id, "checks", `artifacts/checks/epoch-${run.mutationEpoch}.json`, {
      revisionId: before.id,
      results
    });
    const passed = this.deps.config.checks.every((check) => !check.required || results.find((result) => result.id === check.id)?.status === "passed");
    const attempt = this.runs.beginAttempt(run, "CHECKS", void 0, "warden");
    this.runs.finalizeAttempt(attempt, {
      status: "completed",
      resultRevisionId: before.id,
      verdict: passed ? "pass" : "fail",
      usage: {
        requests: 0
      }
    });
    this.gates.save({
      runId: run.id,
      gate: "checks",
      revisionId: before.id,
      mutationEpoch: run.mutationEpoch,
      configHash: run.configHash,
      gatePolicyHash: JSON.stringify(this.deps.config.checks),
      verdict: passed ? "pass" : "fail",
      attemptId: attempt.id,
      artifactId: artifact.id,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      endedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (passed) {
      this.findings.resolveGate(run.id, "checks", attempt.id);
      return this.transition(run, "SECURITY", "CHECKS_PASSED", {
        revisionId: before.id
      });
    }
    for (const result of results.filter((item) => item.status !== "passed")) this.lifecycle.upsert(run.id, "checks", run.mutationEpoch, attempt, {
      severity: "high",
      category: "deterministic-check",
      title: `${result.id} failed`,
      description: result.summary,
      fixRequirement: `Make ${result.id} pass before requesting another gate`
    });
    return this.transition(run, "IMPLEMENT", "CHECK_FAILED", {
      revisionId: before.id
    });
  }
  async executeSecurity(run, signal) {
    const securityAttempts = this.runs.attemptsFor(run.id, "SECURITY");
    this.budget.assertRoleMayRun(run, "security", securityAttempts.length, securityAttempts.reduce((total, attempt2) => total + attempt2.tokens, 0));
    const before = await this.deps.revisions.current();
    if (before.id !== run.currentRevisionId) return this.mutation(run, before.id, "SECURITY_EXTERNAL_MUTATION");
    if (!this.gates.currentPass(run.id, "checks", before.id, run.configHash, JSON.stringify(this.deps.config.checks))) return this.transition(run, "CHECKS", "STALE_CHECK_PASS_REJECTED");
    const attempt = this.runs.beginAttempt(run, "SECURITY", "security", this.deps.config.agents.security.agent);
    const handoff = this.context.build("security", {
      run,
      objective: this.objective(run),
      plan: run.planPath ? {
        id: "plan",
        path: run.planPath,
        sha256: ""
      } : void 0,
      findings: this.findings.list(run.id, "open"),
      changedFiles: await this.deps.revisions.changedFiles(run.baseRevisionId, run.currentRevisionId),
      evidence: []
    });
    await this.deps.artifacts.putJson(run.id, "handoff", `artifacts/security/handoff-${attempt.sequence}.json`, handoff.envelope, attempt.id);
    const result = await this.deps.agents.run({
      runId: run.id,
      attemptId: attempt.id,
      role: "security",
      agentName: this.deps.config.agents.security.agent,
      assignment: "Perform a read-only security review and return SecurityOutput.",
      context: handoff.text,
      outputSchema: {
        name: "SecurityOutput",
        version: 1
      },
      schemaMode: "strict",
      cwd: run.workspaceRoot,
      baseRevisionId: before.id,
      readOnly: true,
      signal
    });
    const after = await this.deps.revisions.current();
    this.runs.finalizeAttempt(attempt, {
      ...result,
      resultRevisionId: after.id
    });
    if (after.id !== before.id) return this.mutation(run, after.id, "SECURITY_MUTATED_WORKSPACE", "CHECKS");
    if (result.status !== "completed") throw new AnvilError("AGENT_EXECUTION_FAILED", result.error?.message ?? "Security agent failed");
    const output = requireSecurity(result.structured);
    const artifact = await this.deps.artifacts.putJson(run.id, "security", `artifacts/security/attempt-${attempt.sequence}.json`, output, attempt.id);
    if (output.verdict === "blocked") return this.block(run, new AnvilError("AGENT_EXECUTION_FAILED", output.blockedReason ?? "Sentinel blocked"));
    let repeatedBlockingFinding = false;
    for (const finding of output.findings) {
      const persisted = this.lifecycle.upsert(run.id, "security", run.mutationEpoch, attempt, {
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        description: finding.description,
        fixRequirement: finding.fixRequirement,
        file: finding.file,
        lineStart: finding.lineStart,
        lineEnd: finding.lineEnd,
        symbol: finding.symbol,
        evidenceArtifactId: artifact.id
      });
      if (persisted.status === "open" && persisted.timesSeen >= 3 && this.deps.config.security.failOn.includes(finding.severity)) repeatedBlockingFinding = true;
    }
    if (repeatedBlockingFinding) return this.block(run, new AnvilError("NO_PROGRESS", "The same blocking Sentinel finding persisted across three attempts"));
    const next = nextAfterSecurity(output, this.deps.config.security.failOn);
    if (next === "IMPLEMENT") return this.transition(run, "IMPLEMENT", "SECURITY_FINDINGS", {
      revisionId: before.id
    });
    this.findings.resolveGate(run.id, "security", attempt.id);
    this.gates.save({
      runId: run.id,
      gate: "security",
      revisionId: before.id,
      mutationEpoch: run.mutationEpoch,
      configHash: run.configHash,
      gatePolicyHash: JSON.stringify(this.deps.config.security),
      verdict: "pass",
      attemptId: attempt.id,
      artifactId: artifact.id,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      endedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return this.transition(run, "REVIEW", "SECURITY_PASSED", {
      revisionId: before.id
    });
  }
  async executeReview(run, signal) {
    const reviewAttempts = this.runs.attemptsFor(run.id, "REVIEW");
    this.budget.assertRoleMayRun(run, "review", reviewAttempts.length, reviewAttempts.reduce((total, attempt2) => total + attempt2.tokens, 0));
    const before = await this.deps.revisions.current();
    if (before.id !== run.currentRevisionId) return this.mutation(run, before.id, "REVIEW_EXTERNAL_MUTATION", "CHECKS");
    if (!this.gates.currentPass(run.id, "checks", before.id, run.configHash, JSON.stringify(this.deps.config.checks)) || !this.gates.currentPass(run.id, "security", before.id, run.configHash, JSON.stringify(this.deps.config.security))) return this.transition(run, "CHECKS", "STALE_GATE_PASS_REJECTED");
    const attempt = this.runs.beginAttempt(run, "REVIEW", "review", this.deps.config.agents.review.agent);
    const handoff = this.context.build("review", {
      run,
      objective: this.objective(run),
      plan: run.planPath ? {
        id: "plan",
        path: run.planPath,
        sha256: ""
      } : void 0,
      findings: this.findings.list(run.id, "open"),
      changedFiles: await this.deps.revisions.changedFiles(run.baseRevisionId, run.currentRevisionId),
      evidence: []
    });
    await this.deps.artifacts.putJson(run.id, "handoff", `artifacts/review/handoff-${attempt.sequence}.json`, handoff.envelope, attempt.id);
    const result = await this.deps.agents.run({
      runId: run.id,
      attemptId: attempt.id,
      role: "review",
      agentName: this.deps.config.agents.review.agent,
      assignment: "Perform a read-only final engineering review and return ReviewOutput.",
      context: handoff.text,
      outputSchema: {
        name: "ReviewOutput",
        version: 1
      },
      schemaMode: "strict",
      cwd: run.workspaceRoot,
      baseRevisionId: before.id,
      readOnly: true,
      signal
    });
    const after = await this.deps.revisions.current();
    this.runs.finalizeAttempt(attempt, {
      ...result,
      resultRevisionId: after.id
    });
    if (after.id !== before.id) return this.mutation(run, after.id, "REVIEW_MUTATED_WORKSPACE", "CHECKS");
    if (result.status !== "completed") throw new AnvilError("AGENT_EXECUTION_FAILED", result.error?.message ?? "Review agent failed");
    const output = requireReview(result.structured);
    const artifact = await this.deps.artifacts.putJson(run.id, "review", `artifacts/review/attempt-${attempt.sequence}.json`, output, attempt.id);
    for (const finding of output.findings) this.lifecycle.upsert(run.id, "review", run.mutationEpoch, attempt, {
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      description: finding.description,
      fixRequirement: finding.fixRequirement,
      file: finding.file,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
      symbol: finding.symbol,
      evidenceArtifactId: artifact.id
    });
    const next = nextAfterReview(output, this.deps.config.review.blockOn);
    if (next === "IMPLEMENT") return this.transition(run, "IMPLEMENT", "REVIEW_FINDINGS", {
      revisionId: before.id
    });
    this.findings.resolveGate(run.id, "review", attempt.id);
    this.gates.save({
      runId: run.id,
      gate: "review",
      revisionId: before.id,
      mutationEpoch: run.mutationEpoch,
      configHash: run.configHash,
      gatePolicyHash: JSON.stringify(this.deps.config.review),
      verdict: "pass",
      attemptId: attempt.id,
      artifactId: artifact.id,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      endedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    await assertCanComplete(run, {
      revisions: this.deps.revisions,
      gates: this.gates,
      findings: this.findings,
      runs: this.runs,
      config: this.deps.config
    });
    const done = this.transition(run, "DONE", "RUN_DONE", {
      revisionId: before.id
    });
    const lessons = this.lessons.get(run.id) ?? [];
    if (this.deps.memory && this.deps.config.memory.enabled && this.deps.config.memory.retainOnSuccess) await this.deps.memory.retain(lessons, done);
    this.lessons.delete(run.id);
    return done;
  }
  transition(run, next, type, payload) {
    assertLegalTransition(run.currentState, next);
    const updated = this.runs.update(run.id, {
      current_state: next,
      status: statusForState(next),
      transition_count: run.transitionCount + 1,
      finished_at: isTerminal(next) ? this.clock.now().toISOString() : null
    }, {
      type,
      stateBefore: run.currentState,
      stateAfter: next,
      revisionId: run.currentRevisionId,
      payload
    });
    return updated;
  }
  mutation(run, revisionId, event, next = "CHECKS") {
    const updated = this.updateRevision(run, revisionId, event);
    return this.transition(updated, next, event, {
      revisionId
    });
  }
  updateRevision(run, revisionId, event) {
    return this.runs.update(run.id, {
      current_revision_id: revisionId,
      mutation_epoch: run.mutationEpoch + 1
    }, event ? {
      type: "WORKSPACE_REVISION_CHANGED",
      stateBefore: run.currentState,
      stateAfter: run.currentState,
      revisionId,
      payload: {
        reason: event
      }
    } : void 0);
  }
  block(run, error) {
    return this.runs.update(run.id, {
      blocked_reason: error.message,
      failure_code: error.code,
      status: "blocked",
      current_state: "BLOCKED",
      finished_at: this.clock.now().toISOString(),
      transition_count: run.transitionCount + 1
    }, {
      type: "RUN_BLOCKED",
      stateBefore: run.currentState,
      stateAfter: "BLOCKED",
      payload: {
        code: error.code,
        message: error.message
      }
    });
  }
  fail(run, error) {
    return this.runs.update(run.id, {
      failure_code: error.code,
      failure_message: error.message,
      status: "failed",
      current_state: "FAILED",
      finished_at: this.clock.now().toISOString(),
      transition_count: run.transitionCount + 1
    }, {
      type: "RUN_FAILED",
      stateBefore: run.currentState,
      stateAfter: "FAILED",
      payload: {
        code: error.code,
        message: error.message
      }
    });
  }
  objective(run) {
    return this.objectivePointers.get(run.id) ?? {
      id: "objective",
      path: run.objectivePath,
      sha256: ""
    };
  }
  summary(run) {
    return {
      run,
      events: this.events.list(run.id),
      findings: this.findings.list(run.id),
      attempts: this.runs.attempts(run.id)
    };
  }
};

// src/runtime.ts
function memoryFromContext(context) {
  if (!context || typeof context !== "object" || !("memory" in context)) return void 0;
  const candidate = context.memory;
  if (!candidate || typeof candidate !== "object" || !("search" in candidate) || !("save" in candidate) || typeof candidate.search !== "function" || typeof candidate.save !== "function") return void 0;
  return candidate;
}
async function createRuntime(workspaceRoot, context, explicitConfigPath) {
  const loaded = await loadConfig(workspaceRoot, explicitConfigPath);
  const absoluteRuntimeRoot = runtimeRoot(workspaceRoot, loaded.persistence.root);
  await ensureRuntimeRoot(absoluteRuntimeRoot);
  const config = {
    ...loaded,
    persistence: {
      ...loaded.persistence,
      root: absoluteRuntimeRoot
    }
  };
  const state = await StateDatabase.open(absoluteRuntimeRoot);
  const artifacts = new ArtifactStore(state, (runId) => path8.join(absoluteRuntimeRoot, "runs", runId));
  const compat = createOmpCompat(context);
  const agents = new OmpSubprocessRunner(compat);
  const discovered = Object.values(config.agents).map((agent) => agent.agent);
  await agents.validate(workspaceRoot, discovered);
  const memory = memoryFromContext(context);
  const engine = new WorkflowEngine({
    config,
    state,
    artifacts,
    revisions: new GitRevisionProvider(workspaceRoot),
    agents,
    checks: new DeterministicCheckRunner(artifacts),
    memory: new OptionalMemoryAdapter(memory)
  });
  return {
    engine,
    config,
    state,
    runtimeRoot: absoluteRuntimeRoot,
    lock: new WorkspaceLock(path8.join(absoluteRuntimeRoot, "lock.json"))
  };
}

// src/commands/router.ts
import { access as access3 } from "node:fs/promises";
import path11 from "node:path";

// src/config/init.ts
import { mkdir as mkdir5, writeFile as writeFile3 } from "node:fs/promises";
import path9 from "node:path";
var GLOBAL_CONFIG_TEMPLATE = `# Shared Forge settings for all repositories.
# Omitted values inherit Anvil's built-in defaults.
# Model mappings live in OMP's global agent config; run /anvil config to see its path.
version: 1
workflow:
  name: secure-code-change
agents:
  planner: # Architect
    agent: architect
  implementation: # Smith
    agent: smith
  security: # Sentinel
    agent: sentinel
  review: # Inquisitor
    agent: inquisitor

# Add shared checks or override budgets below.
`;
var PROJECT_CONFIG_TEMPLATE = `# Repository-specific Forge overrides.
# Values here override the global settings; omitted values continue to inherit.
version: 1
`;
async function ensureGlobalConfig() {
  return createIfMissing(globalConfigPath(), GLOBAL_CONFIG_TEMPLATE);
}
async function initConfig(workspaceRoot) {
  const created = [];
  const existing = [];
  const global = await createIfMissing(globalConfigPath(), GLOBAL_CONFIG_TEMPLATE);
  record(global, created, existing);
  const repositoryRoot = await findRepositoryRoot(workspaceRoot);
  if (!repositoryRoot) return {
    global,
    created,
    existing
  };
  const project = await createIfMissing(projectConfigPath(repositoryRoot), PROJECT_CONFIG_TEMPLATE);
  record(project, created, existing);
  return {
    global,
    project,
    repositoryRoot,
    created,
    existing
  };
}
async function createIfMissing(filePath, content) {
  await mkdir5(path9.dirname(filePath), {
    recursive: true
  });
  try {
    await writeFile3(filePath, content, {
      encoding: "utf8",
      flag: "wx"
    });
    return {
      path: filePath,
      status: "created"
    };
  } catch (error) {
    if (isAlreadyExists(error)) return {
      path: filePath,
      status: "existing"
    };
    throw error;
  }
}
function record(report, created, existing) {
  (report.status === "created" ? created : existing).push(report.path);
}
function isAlreadyExists(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

// src/ui/render.ts
var STAGE_LABELS = {
  INIT: "Initializing",
  PLAN: "Architect",
  IMPLEMENT: "Smith",
  CHECKS: "Warden",
  SECURITY: "Sentinel",
  REVIEW: "Inquisitor"
};
function renderForgeHelp() {
  return [
    "ANVIL \xB7 FORGE",
    "",
    "Run the bounded Architect \u2192 Smith \u2192 Warden \u2192 Sentinel \u2192 Inquisitor workflow.",
    "",
    "/forge <objective>",
    "/forge help",
    "",
    "Inspect runs and manage configuration with /anvil.",
    "",
    "/anvil config",
    "/anvil doctor",
    "/anvil init",
    "/anvil update check|install",
    "/anvil status [run-id]",
    "/anvil resume <run-id>",
    "/anvil findings [run-id]",
    "/anvil cancel <run-id>",
    ""
  ].join("\n");
}
function renderAnvilHelp() {
  return [
    "ANVIL \xB7 MANAGEMENT",
    "",
    "Inspect configuration, manage runs, and update Anvil.",
    "",
    "/anvil config",
    "/anvil doctor",
    "/anvil init",
    "/anvil status [run-id]",
    "/anvil resume <run-id>",
    "/anvil cancel <run-id>",
    "/anvil findings [run-id]",
    "/anvil update check",
    "/anvil update install",
    "/anvil help",
    "",
    "Run a workflow with /forge <objective>."
  ].join("\n");
}
function renderConfiguration(locations) {
  const globalState = locations.globalConfigPresent ? "present" : "not present";
  const projectState = locations.projectConfigPresent ? "present" : "not present";
  const configState = locations.configError ? `INVALID  ${locations.configError}` : "VALID";
  const roleLines = WORKFLOW_ROLE_ORDER.map((role) => `  ${ROLE_LABELS[role].padEnd(11)} @${MODEL_ROLE_ALIASES[role]}`);
  return [
    "ANVIL \xB7 CONFIGURATION",
    "",
    `STATUS            ${configState}`,
    "",
    "GLOBAL LOCATIONS",
    `  Anvil config     ${locations.globalConfig} (${globalState})`,
    `  OMP model maps   ${locations.globalModels}`,
    "",
    "PROJECT LOCATIONS",
    `  Overlay          ${locations.projectConfig} (${projectState})`,
    `  Runtime state    ${locations.runtimeRoot}`,
    "",
    "MODEL ROLES",
    ...roleLines,
    "  Warden       deterministic checks (no model)",
    "",
    "COMMANDS",
    "  /anvil config",
    "  /anvil doctor",
    "  /anvil init",
    "  /anvil update check|install",
    "  /forge <objective>"
  ].join("\n");
}
function renderDoctor(locations) {
  return [
    "ANVIL \xB7 DOCTOR",
    "",
    locations.configError ? `CONFIGURATION  INVALID  ${locations.configError}` : "CONFIGURATION  VALID",
    "RUNTIME        AVAILABLE",
    "AGENTS         AVAILABLE",
    "",
    `GLOBAL CONFIG  ${locations.globalConfig}`,
    `MODEL MAPPINGS ${locations.globalModels}`,
    `RUNTIME STATE  ${locations.runtimeRoot}`
  ].join("\n");
}
function renderInit(report) {
  return [
    "ANVIL \xB7 INITIALIZE",
    "",
    "CONFIGURATION FILES",
    `GLOBAL       ${report.global.status.toUpperCase()}  ${report.global.path}`,
    report.project ? `PROJECT      ${report.project.status.toUpperCase()}  ${report.project.path}` : "PROJECT      NOT CREATED  (no repository root found)",
    report.repositoryRoot ? `REPOSITORY   ${report.repositoryRoot}` : "REPOSITORY   NOT FOUND",
    "",
    "CREATED",
    ...report.created.length > 0 ? report.created.map((filePath) => `  ${filePath}`) : [
      "  none"
    ],
    "",
    "ALREADY EXISTING",
    ...report.existing.length > 0 ? report.existing.map((filePath) => `  ${filePath}`) : [
      "  none"
    ],
    "",
    "Initialization is non-destructive: existing settings were left unchanged."
  ].join("\n");
}
function renderUpdate(report) {
  const state = report.updated ? "UPDATED" : report.updateAvailable ? "AVAILABLE" : "CURRENT";
  const heading = report.updated ? "ANVIL \xB7 UPDATED" : `ANVIL \xB7 UPDATE ${state}`;
  return [
    heading,
    "",
    `${"INSTALLED".padEnd(12)}${report.currentVersion}`,
    `${"LATEST".padEnd(12)}${report.latestVersion ?? "none"}`,
    `${"MANAGED".padEnd(12)}${report.managed ? "OMP marketplace" : "source checkout"}`,
    "",
    report.message ?? (report.releaseUrl ? `RELEASE    ${report.releaseUrl}` : "No published stable release available.")
  ].join("\n");
}
function renderStatus(summary) {
  const run = summary.run;
  const attempts = summary.attempts.reduce((counts, attempt) => {
    counts[attempt.state] = (counts[attempt.state] ?? 0) + 1;
    return counts;
  }, {});
  const open2 = summary.findings.filter((finding) => finding.status === "open");
  return [
    `ANVIL \xB7 FORGE RUN ${run.id}`,
    "",
    `STATUS       ${run.status.toUpperCase()}`,
    `STAGE        ${displayState(run.currentState).toUpperCase()}`,
    `REVISION     ${run.currentRevisionId}`,
    `EPOCH        ${run.mutationEpoch}`,
    `TRANSITIONS  ${run.transitionCount}`,
    "",
    "ATTEMPTS",
    ...Object.entries(attempts).map(([state, count]) => `  ${(STAGE_LABELS[state] ?? state).padEnd(12)} ${count}`),
    "",
    `OPEN FINDINGS ${open2.length}`,
    ...open2.slice(0, 8).map((finding) => `  ${finding.id}  ${finding.severity.toUpperCase()}  ${finding.title}`),
    "",
    "USAGE",
    `  ${run.usedTokens.toLocaleString()} tokens \xB7 ${run.usedRequests} requests`,
    "",
    `ARTIFACTS    ${run.workspaceRoot}/.omp/.anvil/runs/${run.id}`
  ].join("\n");
}
function renderFindings(summary) {
  if (summary.findings.length === 0) return "ANVIL \xB7 NO FINDINGS\n\nThe Forge has no recorded findings for this run.";
  return [
    "ANVIL \xB7 FINDINGS",
    "",
    ...summary.findings.map((finding) => `${finding.id}  ${finding.status.toUpperCase()}  ${finding.severity.toUpperCase()}
${finding.title}
${finding.description}`)
  ].join("\n\n");
}

// src/update.ts
import { readFile as readFile5 } from "node:fs/promises";
import path10 from "node:path";
import { fileURLToPath } from "node:url";
var UpdateError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UpdateError";
  }
};
var REPOSITORY = "MSpiechowicz/oh-my-pi-anvil";
var MARKETPLACE = "omp-anvil";
var PLUGIN_ID = "oh-my-pi-anvil@omp-anvil";
var RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
var RELEASE_BASE = `https://github.com/${REPOSITORY}/releases/tag/`;
var MODULE_DIRECTORY = path10.dirname(fileURLToPath(import.meta.url));
var PACKAGE_ROOT = [
  "src",
  "dist"
].includes(path10.basename(MODULE_DIRECTORY)) ? path10.resolve(MODULE_DIRECTORY, "..") : MODULE_DIRECTORY;
var SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
function versionTuple(value2) {
  const match = SEMVER.exec(value2);
  if (!match) throw new UpdateError("Expected a stable MAJOR.MINOR.PATCH version.");
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3])
  ];
}
function newer(left, right) {
  const a = versionTuple(left);
  const b = versionTuple(right);
  return a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
}
async function packageVersion(root = PACKAGE_ROOT) {
  try {
    const packageJson = JSON.parse(await readFile5(path10.join(root, "package.json"), "utf8"));
    if (!packageJson.version) throw new Error("missing version");
    versionTuple(packageJson.version);
    return packageJson.version;
  } catch (error) {
    throw new UpdateError(`Cannot read a valid Anvil package version: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function latestRelease(fetcher = fetch) {
  let response;
  try {
    response = await fetcher(RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "omp-anvil-updater"
      },
      redirect: "error"
    });
  } catch (error) {
    throw new UpdateError(`Cannot retrieve the public GitHub release: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new UpdateError(`GitHub release request failed (HTTP ${response.status}).`);
  const body = await response.arrayBuffer();
  if (body.byteLength > 1024 * 1024) throw new UpdateError("GitHub release response exceeded the size limit.");
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new UpdateError("GitHub returned invalid release metadata.");
  }
  if (!data || typeof data !== "object") throw new UpdateError("GitHub returned invalid release metadata.");
  const release = data;
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string" || !release.tag_name.startsWith("v")) throw new UpdateError("GitHub did not return a published stable release.");
  const version = release.tag_name.slice(1);
  versionTuple(version);
  return {
    version,
    tag: release.tag_name,
    url: RELEASE_BASE + release.tag_name
  };
}
async function native(profile, args, timeoutMs, cwd) {
  const command = [
    "omp"
  ];
  if (profile) command.push("--profile", profile);
  command.push("plugin", ...args);
  const result = await runProcess(command, {
    cwd,
    timeoutMs
  });
  if (result.status !== "passed") throw new UpdateError(`OMP plugin ${args[0] ?? "operation"} failed; inspect the native OMP command output and retry.`);
  return result.stdout;
}
function marketplaceEntries(data) {
  if (!data || typeof data !== "object" || !("marketplace" in data) || !Array.isArray(data.marketplace)) throw new UpdateError("OMP does not support `omp plugin list --json`; upgrade OMP before updating Anvil.");
  return data.marketplace;
}
async function installedPlugins(profile, cwd) {
  let data;
  try {
    data = JSON.parse(await native(profile, [
      "list",
      "--json"
    ], 8e3, cwd));
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError("Cannot read native OMP marketplace installations.");
  }
  return marketplaceEntries(data);
}
async function managedInstallation(profile, expectedRoot, cwd) {
  const matches = [];
  for (const summary of await installedPlugins(profile, cwd)) {
    if (summary.id !== PLUGIN_ID || summary.scope !== "user" && summary.scope !== "project" || summary.shadowedBy || !summary.entries || summary.entries.length !== 1) continue;
    const entry = summary.entries[0];
    if (entry.enabled === false || entry.scope !== summary.scope || !entry.installPath || !path10.isAbsolute(entry.installPath) || expectedRoot && path10.resolve(entry.installPath) !== path10.resolve(expectedRoot)) continue;
    const version = await packageVersion(entry.installPath);
    if (entry.version !== version) throw new UpdateError("OMP registry and installed Anvil versions disagree; inspect `omp plugin list` before updating.");
    matches.push({
      scope: summary.scope,
      installPath: path10.resolve(entry.installPath),
      version
    });
  }
  if (matches.length > 1) throw new UpdateError("Anvil has multiple active marketplace installations; remove the ambiguity before updating.");
  return matches[0];
}
async function checkUpdate(profile, cwd = process.cwd()) {
  const currentVersion = await packageVersion();
  const release = await latestRelease();
  const managed = Boolean(await managedInstallation(profile, PACKAGE_ROOT, cwd));
  const report = {
    currentVersion,
    latestVersion: release?.version ?? null,
    updateAvailable: Boolean(release && managed && newer(release.version, currentVersion)),
    releaseUrl: release?.url ?? null,
    managed
  };
  if (!report.managed) report.message = "This Anvil installation is not an unambiguous active OMP marketplace installation. Source checkouts are updated with git pull and a rebuild.";
  else if (!release) report.message = "No published stable GitHub release is available.";
  return report;
}
async function installUpdate(profile, cwd = process.cwd()) {
  const initial = await managedInstallation(profile, PACKAGE_ROOT, cwd);
  if (!initial) throw new UpdateError("This Anvil installation is not an unambiguous active OMP marketplace installation. Source checkouts are never overwritten.");
  const currentVersion = await packageVersion();
  const release = await latestRelease();
  const report = {
    currentVersion,
    latestVersion: release?.version ?? null,
    updateAvailable: release ? newer(release.version, currentVersion) : false,
    releaseUrl: release?.url ?? null,
    managed: true
  };
  if (!release || !report.updateAvailable) return {
    ...report,
    updated: false,
    message: "No newer stable release is available."
  };
  await native(profile, [
    "marketplace",
    "update",
    MARKETPLACE
  ], 55e3, cwd);
  const stillInitial = await managedInstallation(profile, PACKAGE_ROOT, cwd);
  if (!stillInitial || stillInitial.scope !== initial.scope || stillInitial.installPath !== initial.installPath || stillInitial.version !== initial.version) throw new UpdateError("The native installation changed during the update check; inspect it before retrying.");
  await native(profile, [
    "upgrade",
    PLUGIN_ID,
    "--scope",
    initial.scope
  ], 75e3, cwd);
  const installed = await managedInstallation(profile, void 0, cwd);
  if (!installed || installed.scope !== initial.scope || !newer(installed.version, currentVersion)) throw new UpdateError("OMP did not install a newer stable Anvil release; the marketplace may not have published it yet.");
  return {
    ...report,
    currentVersion: installed.version,
    updated: true,
    message: `Updated to ${installed.version} using OMP plugin upgrade. Restart OMP to load the updated extension.`
  };
}
async function runUpdate(action, profile, cwd = process.cwd()) {
  return action === "check" ? checkUpdate(profile, cwd) : installUpdate(profile, cwd);
}

// src/commands/router.ts
async function configurationLocations(cwd) {
  const projectRoot = await findRepositoryRoot(cwd);
  const existingProject = await nearestProjectConfigPath(cwd);
  const projectConfig = existingProject ?? (projectRoot ? projectConfigPath(projectRoot) : projectConfigPath(cwd));
  const globalConfig = globalConfigPath();
  let globalConfigPresent = false;
  let effectiveRuntimeRoot = path11.resolve(cwd, ".omp", ".anvil");
  let configError;
  try {
    await access3(globalConfig);
    globalConfigPresent = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      configError = error instanceof Error ? error.message : String(error);
    }
  }
  try {
    const config = await loadConfig(cwd);
    effectiveRuntimeRoot = runtimeRoot(cwd, config.persistence.root);
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }
  return {
    globalConfig,
    globalConfigPresent,
    globalModels: globalModelsConfigPath(),
    projectConfig,
    projectConfigPresent: Boolean(existingProject),
    runtimeRoot: effectiveRuntimeRoot,
    configError
  };
}
var CommandRouter = class {
  engineFactory;
  constructor(engineFactory) {
    this.engineFactory = engineFactory;
  }
  async handle(raw, context) {
    const objective = raw.trim();
    if (!objective || objective === "help") return renderForgeHelp();
    let runtime;
    let lockHeld = false;
    try {
      runtime = await this.engineFactory(context);
      await runtime.lock.acquire(`pending_${crypto.randomUUID()}`);
      lockHeld = true;
      return renderStatus(await runtime.engine.start({
        objective,
        workspaceRoot: context.cwd
      }));
    } catch (error) {
      const typed = error instanceof AnvilError ? error : new AnvilError("PERSISTENCE_ERROR", error instanceof Error ? error.message : String(error));
      return `ANVIL \xB7 ${typed.code}

${typed.message}`;
    } finally {
      if (runtime) {
        if (lockHeld) await runtime.lock.release();
        runtime.state.close();
      }
    }
  }
  async handleAdmin(raw, context) {
    const [command, ...rest] = raw.trim().split(/\s+/).filter(Boolean);
    if (!command || command === "help") return renderAnvilHelp();
    let runtime;
    let lockHeld = false;
    try {
      if (command === "config") {
        if (rest.length > 0 && !(rest.length === 1 && rest[0] === "show")) throw new AnvilError("CONFIG_INVALID", "Usage: /anvil config");
        return renderConfiguration(await configurationLocations(context.cwd));
      }
      if (command === "init") {
        if (rest.length > 0) throw new AnvilError("CONFIG_INVALID", "Usage: /anvil init");
        return renderInit(await initConfig(context.cwd));
      }
      if (command === "update") {
        if (rest.length !== 1 || rest[0] !== "check" && rest[0] !== "install") throw new AnvilError("CONFIG_INVALID", "Usage: /anvil update check|install");
        return renderUpdate(await runUpdate(rest[0], process.env.OMP_PROFILE ?? process.env.PI_PROFILE, context.cwd));
      }
      if (command === "doctor") {
        if (rest.length > 0) throw new AnvilError("CONFIG_INVALID", "Usage: /anvil doctor");
        const locations = await configurationLocations(context.cwd);
        runtime = await this.engineFactory(context);
        return renderDoctor({
          ...locations,
          runtimeRoot: runtime.runtimeRoot ?? locations.runtimeRoot
        });
      }
      if (command === "status" || command === "findings") {
        if (rest.length > 1) throw new AnvilError("CONFIG_INVALID", `Usage: /anvil ${command} [run-id]`);
        runtime = await this.engineFactory(context);
        const summary = runtime.engine.status(rest[0]);
        return command === "status" ? renderStatus(summary) : renderFindings(summary);
      }
      if (command === "resume" || command === "cancel") {
        if (rest.length !== 1) throw new AnvilError("CONFIG_INVALID", `Usage: /anvil ${command} <run-id>`);
        runtime = await this.engineFactory(context);
        await runtime.lock.acquire(rest[0]);
        lockHeld = true;
        if (command === "resume") return renderStatus(await runtime.engine.resume(rest[0]));
        await runtime.engine.cancel(rest[0]);
        return renderStatus(runtime.engine.status(rest[0]));
      }
      throw new AnvilError("CONFIG_INVALID", `Unknown /anvil command: ${command}`);
    } catch (error) {
      if (error instanceof UpdateError) return `ANVIL \xB7 UPDATE FAILED

${error.message}`;
      const typed = error instanceof AnvilError ? error : new AnvilError("PERSISTENCE_ERROR", error instanceof Error ? error.message : String(error));
      return `ANVIL \xB7 ${typed.code}

${typed.message}`;
    } finally {
      if (runtime) {
        if (lockHeld) await runtime.lock.release();
        runtime.state.close();
      }
    }
  }
};

// src/extension.ts
var UPDATE_STATUS_KEY = "anvil-update";
async function selectAnvilCommand(args, context) {
  let input = args.trim().replace(/^\/anvil\s*/, "");
  if (input === "help" || context.hasUI === false || typeof context.ui?.select !== "function") return input;
  if (!input) {
    const section = await context.ui.select("Anvil", [
      "Configuration",
      "Initialize",
      "Doctor",
      "Run management",
      "Update"
    ]);
    if (!section) return void 0;
    if (section === "Configuration") return "config";
    if (section === "Initialize") return "init";
    if (section === "Doctor") return "doctor";
    if (section === "Run management") input = "runs";
    else input = "update";
  }
  if (input === "runs") {
    const action = await context.ui.select("Anvil / Run management", [
      "Status",
      "Resume",
      "Cancel",
      "Findings"
    ]);
    if (!action) return void 0;
    if (action === "Status") return "status";
    if (action === "Findings") return "findings";
    if (typeof context.ui.input !== "function") return void 0;
    const runId = await context.ui.input(`Run ID to ${action.toLowerCase()}`, "run_");
    if (!runId?.trim()) return void 0;
    return `${action.toLowerCase()} ${runId.trim()}`;
  }
  if (input === "update") {
    const action = await context.ui.select("Anvil / Update", [
      "Check",
      "Install"
    ]);
    if (!action) return void 0;
    if (action === "Check") return "update check";
    if (action === "Install") return "update install";
  }
  return input;
}
function anvilExtension(pi) {
  pi.setLabel?.("Anvil \xB7 The Forge");
  const router = new CommandRouter(async (context) => createRuntime(context.cwd, context.runtimeContext ?? context));
  const notifyOutput = async (context, output) => {
    if (context.ui?.notify) await context.ui.notify(output, "info");
    else await context.respond?.(output);
  };
  const forgeHandler = async (args, context) => {
    const input = args.trim().replace(/^\/forge\s*/, "");
    await notifyOutput(context, await router.handle(input, {
      cwd: context.cwd,
      runtimeContext: context
    }));
  };
  const anvilHandler = async (args, context) => {
    const input = await selectAnvilCommand(args, context);
    if (input === void 0) return;
    if (input === "update check" || input === "update install") {
      await context.ui?.setStatus?.(UPDATE_STATUS_KEY, void 0);
    }
    await notifyOutput(context, await router.handleAdmin(input, {
      cwd: context.cwd,
      runtimeContext: context
    }));
  };
  pi.registerCommand("anvil", {
    description: "Inspect Anvil configuration and manage updates",
    handler: anvilHandler
  });
  pi.registerCommand("forge", {
    description: "Run Anvil's bounded multi-agent workflow",
    handler: forgeHandler
  });
  const notify = async (context, message, level) => {
    try {
      if (context.ui?.notify) await context.ui.notify(message, level);
      else await context.respond?.(message);
    } catch {
    }
  };
  const checkForUpdate = async (context) => {
    try {
      const report = await checkUpdate(process.env.OMP_PROFILE ?? process.env.PI_PROFILE, context.cwd);
      const message = report.updateAvailable && report.managed ? "Anvil update available. Run `/anvil update install` to update it." : void 0;
      if (typeof context.ui?.setStatus === "function") {
        await context.ui.setStatus(UPDATE_STATUS_KEY, message);
      } else if (message) {
        await notify(context, message, "warning");
      }
    } catch {
    }
  };
  pi.on?.("session_start", async (_event, context) => {
    try {
      const report = await ensureGlobalConfig();
      if (report.status === "created") {
        await notify(context, `Anvil is installed. Created the global configuration at ${report.path}. Edit this file, then run /anvil doctor. In a repository, run /anvil init to create the project overlay.`, "info");
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await notify(context, `Anvil could not create its global configuration: ${detail}. Check the configuration directory permissions and run /anvil init after fixing them.`, "warning");
    }
    if (context.hasUI !== false) context.setTimeout?.(() => checkForUpdate(context), 0);
  });
}
export {
  anvilExtension as default
};
