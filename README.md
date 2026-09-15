<div align="center">
  <img src="assets/anvil-mark.webp" alt="Anvil forge mark" width="520" />
  <h1>Anvil</h1>
  <p><strong>Forge reliable software with a team of specialized AI agents.</strong></p>
  <p>
    <a href="#quick-start">Quick start</a> ·
    <a href="#the-forge">The Forge</a> ·
    <a href="#configuration">Configuration</a> ·
    <a href="#safety-invariants">Safety</a>
  </p>
</div>

<p align="center">
  <img src="assets/anvil-team.webp" alt="The Anvil team in the Forge" width="100%" />
</p>

Anvil is an OMP extension for taking a software objective from a written plan to a verified workspace revision. The user-facing workflow command is **`/forge`**; **`/anvil`** handles configuration, diagnostics, run management, and updates. Behind those commands, Anvil runs a deterministic, persistent workflow engine that coordinates the **Architect**, **Smith**, **Warden**, **Sentinel**, and **Inquisitor**, with optional **Scout** reconnaissance and **Archivist** knowledge retention enabled by default.

Unlike prompt-only agent chains, the Forge records state and evidence as it works. Findings return to the Smith for correction, every code mutation invalidates earlier verification, and a run is only **Sealed** when checks, security, and review pass against the same workspace revision.

## Why Anvil

| Property | What it means in practice |
| --- | --- |
| Deterministic control flow | TypeScript owns every transition. Workers never choose the next state. |
| Exact revision gates | Git plus untracked-file fingerprints make stale passes unusable. |
| Resumable state | SQLite owns the run. JSON and text artifacts hold the evidence. |
| Bounded handoffs | Workers receive structured references, not replayed transcripts. |
| Cyclic correction | Review findings return through Smith, Warden, Sentinel, and Inquisitor. |
| Replaceable specialists | Agent names and model roles are configuration, not hard-coded providers. |

## The Forge

Gates remain ordered, but implementation can fan out. Architect can propose one or more Smith tasks with explicit ownership, dependencies, and acceptance criteria. Independent tasks run concurrently; overlapping or dependent work stays sequential. Warden failures and Sentinel/Inquisitor findings use the same dispatch path: reviewers may propose repair tasks, otherwise Architect decomposes the open findings. Every gate evaluates the combined current revision, never a partially finished Smith batch.

Scout runs before Architect inside `PLAN`; Archivist runs after a passing review, before sealing inside `REVIEW`. Both are advisory, not additional correctness gates. Disabled roles are skipped; Archivist also requires memory and successful-run retention to be enabled.

<p align="center">
  <img src="assets/diagrams/forge-lifecycle.svg" alt="Forge lifecycle: optional Scout reconnaissance, Architect planning, Smith implementation, Warden checks, Sentinel security, Inquisitor review, optional Archivist retention, then Sealed. Advisory roles do not replace exact-revision gates." width="100%" />
</p>

The correction path is never a shortcut around verification:

<p align="center">
  <img src="assets/diagrams/forge-correction-loop.svg" alt="Forge correction loop: failures or findings dispatch Smith repairs using reviewer tasks or Architect decomposition, followed by exact-revision verification. Scout is not repeated; optional Archivist retention happens before sealing." width="100%" />
</p>

Every Smith source mutation starts the gate sequence again. Verification-only work can reuse valid Warden/Sentinel passes when revision, policy, mutation epoch, and evidence dependencies remain valid; the gate that raised a finding runs again. Reviewers verify before-and-after workspace fingerprints, so a source mutation during security or review cannot be mistaken for a pass.

Anvil supplies reviewers with a readable baseline-to-target patch, revision manifest, persisted Smith report, verification evidence, and Warden results. The baseline preserves pre-existing dirty content; runtime artifacts are excluded from source revisions. Sentinel and Inquisitor also have scoped `curl`/`gh` access through `bash` and browser access through `eval` for targeted validation. Their instructions prohibit source changes and unauthorized remote writes, but general-purpose execution tools are not a read-only sandbox. Live validation is not reusable evidence of unchanged remote state. See [Configuration](docs/configuration.md#revision-and-gate-behavior).

## The specialists

<table>
<tr>
<td width="50%"><img src="assets/roles/architect.webp" alt="Architect" width="100%" /><br /><strong>Architect</strong><br />Plans the change and acceptance criteria.</td>
<td width="50%"><img src="assets/roles/smith.webp" alt="Smith" width="100%" /><br /><strong>Smith</strong><br />Writes and repairs the repository.</td>
</tr>
<tr>
<td><img src="assets/roles/warden.webp" alt="Warden" width="100%" /><br /><strong>Warden</strong><br />Runs checks, scanners, and policy commands.</td>
<td><img src="assets/roles/sentinel.webp" alt="Sentinel" width="100%" /><br /><strong>Sentinel</strong><br />Audits the exact current revision.</td>
</tr>
<tr>
<td><img src="assets/roles/inquisitor.webp" alt="Inquisitor" width="100%" /><br /><strong>Inquisitor</strong><br />Reviews correctness and maintainability.</td>
<td><img src="assets/roles/scout.webp" alt="Scout" width="100%" /><br /><strong>Scout</strong><br />Optional focused repository reconnaissance.</td>
</tr>
</table>

<p align="center"><img src="assets/roles/archivist.webp" alt="Archivist" width="48%" /><br /><strong>Archivist</strong><br />Optional durable project knowledge. Memory never owns workflow correctness.</p>

Scout and Archivist are enabled by default. Set `scouting.enabled: false` to skip Scout or `memory.archivist: false` to skip Archivist. Scout runs once before Architect within `PLAN`; Archivist runs once before sealing within `REVIEW`, provided `memory.enabled` and `memory.retainOnSuccess` are also true. Scout supplies advisory reconnaissance; Archivist curates lessons from persisted successful Smith evidence. Their attempts, outputs, and usage are recorded independently of the main roles. They do not add workflow states or bypass exact-revision gates, and any repository mutation still invalidates earlier verification.

## Quick start

Install Anvil through OMP. A new OMP session or restart of OMP is required after installation so it loads Anvil. In that first session, Anvil automatically creates the editable global settings template and shows its exact path in the OMP notification area; it does not modify the current repository during this first-run setup.
```bash
# Register the Anvil marketplace and install the stable release
omp plugin marketplace add MSpiechowicz/oh-my-pi-anvil
omp plugin install oh-my-pi-anvil@omp-anvil --scope user

# After installing, open a new OMP session or restart OMP so Anvil loads.
# Inspect the global configuration and both global storage paths:
/anvil config

# Verify the installation:
/anvil doctor

# From the repository where you want a project overlay. Running this from
# a subdirectory still targets the repository root.
/anvil init

# The objective text is the Forge start point; no "start" subcommand is needed.
/forge "Add scoped API-key rotation with a backwards-compatible rollout"
```

The automatic first-run setup creates the global file at `$XDG_CONFIG_HOME/omp/anvil.yml` when `XDG_CONFIG_HOME` is set, or at `~/.config/omp/anvil.yml` otherwise. If the file already exists, startup leaves it unchanged and shows no repeated setup notification. `/anvil init` creates the optional project overlay at the repository root as `.omp/anvil.yml`. Missing files are created as editable text; existing settings are preserved.

Forge loads settings in this order, with later values taking precedence:

1. built-in defaults;
2. the global user file;
3. the nearest repository `.omp/anvil.yml` overlay.

The project overlay is intentionally small: put shared checks and agent choices in the global file, then add only repository-specific overrides to `.omp/anvil.yml`.

When the merged `checks` list is empty, Forge automatically discovers supported finite verification scripts from the repository; a nonempty explicit list overrides discovery. Discovered checks populate only the effective configuration, without editing your settings. If no supported checks are found, the run stops before model work rather than passing without verification. Architect can require only effective check IDs; browser/manual proof belongs in acceptance evidence. See [Warden verification requirements](docs/configuration.md#warden-verification-requirements) for supported manifests, package-manager selection, and overrides.

With an interactive OMP UI, `/anvil` without arguments opens a management menu; the explicit subcommands remain available for scripts and non-interactive sessions.

Inspect and control an existing run through `/anvil`:

```text
/anvil status [run-id]
/anvil resume run_<id>
/anvil findings run_<id>
/anvil cancel run_<id>
```

## Marketplace installation and updates

Register the Anvil marketplace and install the stable release through OMP:

```bash
omp plugin marketplace add MSpiechowicz/oh-my-pi-anvil
omp plugin install oh-my-pi-anvil@omp-anvil --scope user
```

Anvil exposes the native update path from inside OMP:

```text
/anvil update check
/anvil update install
```

The standalone command-line entrypoint is also available when the package is on your `PATH`:

```bash
anvil-update check
anvil-update install
```

Updates verify the published stable GitHub release, refresh the registered marketplace, upgrade only the active unambiguous Anvil installation, and confirm that OMP installed a newer version. Source checkouts are never overwritten; update those with `git pull --ff-only`, then run `deno task build`.
Interactive OMP startups also request a fresh public release check in the background. A managed installation shows `Anvil update available. Run /anvil update install to update it.` as a warning when a newer stable release exists; `/anvil update check` reports its result as a single plain line such as `Anvil 0.1.12: No newer release available.` Startup failures stay quiet and no code is installed automatically. Source checkouts do not show this marketplace-update warning.

## Configuration

The V1 workflow is intentionally fixed. Configuration controls specialists, deterministic checks, policies, budgets, persistence, and memory, while the state machine remains code-owned. Settings are assembled from built-in defaults, the global user file, and an optional project overlay; project values override global values.

The shared global file is:

```text
$XDG_CONFIG_HOME/omp/anvil.yml
```

When `XDG_CONFIG_HOME` is not set, Forge uses:

```text
~/.config/omp/anvil.yml
```

OMP's global model-role mappings are stored in `~/.omp/agent/config.yml` by default, or in `$PI_CODING_AGENT_DIR/config.yml` when a custom agent directory is active. Named profiles use their profile agent directory. `/anvil config` prints the active paths.

The optional repository-specific overlay is:

```text
<repository-root>/.omp/anvil.yml
```

For example, keep common agent mappings and checks in the global file, then customize one repository with a small overlay:

```yaml
# $XDG_CONFIG_HOME/omp/anvil.yml
agents:
  planner: # Architect
    agent: architect
  implementation: # Smith
    agent: smith
checks:
  - id: typecheck
    command: [deno, task, typecheck]
    required: true
    timeoutMs: 180000
```

```yaml
# <repository-root>/.omp/anvil.yml
# Values here override the global settings for this repository.
agents:
  implementation: # Smith
    agent: my-repository-smith
checks:
  - id: lint
    command: [deno, task, lint]
    required: true
    timeoutMs: 120000
```

An overlay can contain only the fields it needs. In this example, the project `checks` list replaces the inherited list, while the other global and default values remain in effect.

A configuration example (new global files expose the complete supported shape):

```yaml
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
  scout: # Optional
    agent: scout
  archivist: # Optional
    agent: archivist

scouting:
  enabled: true # Set false to skip Scout.

checks:
  - id: typecheck
    command: [deno, task, typecheck]
    required: true
    timeoutMs: null # No timeout unless explicitly configured.

security:
  failOn: [critical, high, medium]

review:
  blockOn: [blocking, major]

implementation:
  maxParallel: 4 # Set 1 to serialize Smith tasks.

planning:
  maxGenerations: null

budgets:
  maxTotalTokens: null
  maxTotalRequests: null
  maxTransitions: null
  maxWallClockMs: null
  perRole:
    implementation:
      maxTokens: null
      maxAttempts: null
      maxRequests: null

context:
  maxInlineChars: 12000
  maxMemoryItems: 5
  maxMemoryChars: 5000

memory:
  enabled: true
  retainOnSuccess: true
  archivist: true # Set false to skip Archivist.
  maxRetainedLessons: 3
```

Resource limits are opt-in; `null` disables a cap while omitted values inherit global settings. Every role has `maxTokens`, `maxAttempts`, and `maxRequests` under `budgets.perRole`; section-level attempt limits are no longer supported. Agent concurrency stays bounded at four Smiths by default. Safety and verification gates remain enabled. See [configuration](docs/configuration.md#optional-resource-limits) for all roles, inheritance, and migration details.

Model selection stays in OMP's global model-role configuration:

```yaml
modelRoles:
  architect: "provider/planner:xhigh"
  smith: "provider/coding:xhigh"
  sentinel: "provider/security:xhigh"
  inquisitor: "provider/review:high"
  scout: "provider/reconnaissance:high"
  archivist: "provider/curation:high"
```

The Warden is deterministic and has no model mapping. The default agent definitions reference the canonical aliases above. Anvil never chooses a provider for you. For the complete configuration reference, see [Configuration](docs/configuration.md).

Each new run snapshots the inherited OMP models and thinking levels into `effective-config.json` under `agents.<role>.model` and `agents.<role>.thinkingLevel`. Set either field explicitly in your Anvil configuration to override inheritance; the saved values are also applied to child execution.

Disabled optional agents are not required by discovery or startup checks. See [Optional Scout and Archivist](docs/configuration.md#optional-scout-and-archivist) for activation rules and strict output contracts.

Memory is bounded, best-effort context for Architect and Smith, not a source of workflow truth. Retention filters unsafe/transient lessons, deduplicates them, and respects `memory.maxRetainedLessons`. Anvil uses OMP's native `context.memory.search` / `save` API (available in OMP 18.1.22), backed by the host's configured memory backend. It does not create a fake provider or enable a backend for you. With no provider, disabled backend, or provider errors, Forge continues without the unavailable memory operation. Archivist failures are advisory; source mutations never permit stale evidence to seal a run.

## Persistence and recovery

**Anvil stores its workflow state and run evidence locally, on the machine running OMP.** The default location is `.anvil/` under the workspace root. Set `persistence.root` to change it: relative paths resolve against the workspace; absolute paths are used directly.

Local persistence does **not** mean an entirely offline workflow. Agent requests go through OMP to your configured model providers, and durable memory uses OMP's configured backend. See [Data storage and privacy](#data-storage-and-privacy) below for those boundaries.

[![Anvil artifact directory tree, including Scout reconnaissance and Archivist lessons](assets/diagrams/forge-artifacts.svg)](assets/diagrams/forge-artifacts.svg)

[Open the full-size diagram](assets/diagrams/forge-artifacts.svg). On GitHub, this opens the SVG file page; use its Raw/download control to view or save the original SVG and zoom without losing detail.

<details>
<summary>Text version of the artifact tree</summary>

```text
.anvil/
├── anvil.db
├── lock.json
└── runs/<run-id>/
    ├── objective.md
    ├── effective-config.json
    ├── metadata.json
    ├── artifacts/
    │   ├── revisions/
    │   │   └── baseline.json
    │   ├── scout/
    │   │   └── result-<attempt-sequence>.json
    │   ├── planner/
    │   │   └── plan-<attempt-sequence>.json
    │   ├── implementation/
    │   ├── checks/
    │   ├── security/
    │   ├── review/
    │   ├── archivist/
    │   │   └── result-<attempt-sequence>.json
    │   └── findings/
    └── logs/
```

</details>

Directories and reports are created as needed. Scout and Archivist reports are present only when those roles produce valid output; the tree shows representative files, not every handoff, snapshot, or captured verification artifact.

SQLite is authoritative for workflow state. Artifacts are hashed and written atomically. Runtime files are excluded from the workspace revision; source edits are not.

Each run also has a readable `metadata.json` with its ID, objective, workspace, UTC ISO-8601 creation/start/update/finish timestamps, status, stage, revision, failure details, and a copyable `resumeCommand` (`null` for terminal runs). It is refreshed at startup, stage boundaries, completion, resume, and cancellation, even without a progress UI. Existing runs acquire the file when resumed or cancelled; there is no automatic historical backfill. This best-effort browsing snapshot is never read as recovery state or gate evidence. After an abrupt process exit it may describe the last recorded stage, not a live process; SQLite remains authoritative.

Forge results and `/anvil status` show a gold text header, the run verdict, open findings, role-colored attempt counts, and a token ledger. The crew includes Scout (cyan), Architect, Smith, Warden, Sentinel, Inquisitor, and Archivist (ivory); roles with no recorded attempts show zero. Agent attempts are counted by role, so advisory work and Architect dispatches do not inflate the surrounding stage's count. Full run IDs, revisions, artifact paths, and accounting caveats remain in the report. Non-UI responses retain the same information without ANSI color.

Each agent invocation retains `artifacts/<role>/output-<attempt-sequence>.json`, including model, thinking level, duration, result, and usage. Smith additionally writes a revision/epoch-bound `artifacts/implementation/<attempt-id>/result.json` and captured supporting files. Warden results use `artifacts/checks/attempt-<attempt-sequence>.json`; gate dependency manifests preserve the evidence used for reuse decisions. Planner outputs are attempt-scoped so replanning does not overwrite earlier gate inputs.

### Data storage and privacy

| Data | Storage and purpose |
| --- | --- |
| Workflow state | Local `.anvil/anvil.db` SQLite database: runs, attempts, events, findings, gate results, usage, and artifact metadata. SQLite uses WAL mode, so companion `anvil.db-wal` / `anvil.db-shm` files may also exist. |
| Run inputs and evidence | Local `.anvil/runs/<run-id>/`: objective, effective configuration, agent handoffs and outputs, plans, Scout/Archivist reports, Smith evidence, check stdout/stderr, review reports, diffs, and full baseline/target workspace snapshots. |
| Workspace coordination | Local `.anvil/lock.json` prevents competing mutating runs in the workspace. |
| Anvil settings | Global `$XDG_CONFIG_HOME/omp/anvil.yml` (otherwise `~/.config/omp/anvil.yml`) and optional project `.omp/anvil.yml`. Each run saves its effective settings for recovery. |
| Durable lessons | Sent through OMP's native memory API to the host-configured backend, **not necessarily stored under `.anvil/` or on this machine**. Backend storage, synchronization, and retention policies apply. |

**What can leave the machine:** OMP sends agent prompts, supplied context, and tool results to the selected model provider. These can contain objective text, source code, diffs, findings, and recalled lessons. Memory searches send a query to the configured memory backend; successful-run retention sends filtered lessons with run context. Agent tools and configured verification commands can also access network services. Choose local model and memory backends, and control tool/command network access, if you require an offline workflow; Anvil's local database alone does not provide that guarantee.

**Sensitive data:** the database and artifacts are ordinary local files; Anvil does not encrypt them at rest. Artifact hashes verify integrity, not confidentiality. Treat the runtime directory as potentially containing private source code, credentials emitted by commands, and sensitive model output. Keep `.anvil/` (or your custom `persistence.root`) out of version control and public uploads; exclusion from Anvil's revision fingerprint is not a Git ignore rule. Use filesystem permissions and disk encryption appropriate to your project, and review artifacts before sharing them.

**Retention and removal:** run evidence remains on disk after a run ends; Anvil has no automatic run-history expiry. To back up or remove local history, first stop active runs and close OMP instances using that workspace, then back up or remove the whole configured runtime directory, including the SQLite database and any WAL files. Removing it loses local run history and resume capability, not source changes. It does not delete OMP sessions, model-provider records, or lessons in the configured memory backend; manage those separately through their respective retention controls.

Set `memory.enabled: false` to disable Anvil memory recall and retention (and Archivist). Set only `memory.retainOnSuccess: false` to stop saving new lessons while allowing recall. Neither option disables local workflow evidence or model-provider requests.

### Recovery behavior

Recovery is state-aware:

- interrupted planning reruns the planner;
- interrupted implementation recomputes the revision and runs checks if files changed;
- interrupted checks rerun checks;
- interrupted security or review reruns the read-only gate after revision validation.
- blocked runs are paused: resolve the blocker, then `/anvil resume <run-id>` returns to the saved stage without repeating completed planning or implementation;
- resume applies current budget settings without resetting usage or attempts; other workflow settings must match the saved effective configuration.
- older runs without baseline snapshots resume only when Anvil can prove the original baseline from its clean historical commit or an exactly matching current workspace; a lost dirty baseline blocks before another reviewer attempt instead of substituting a `HEAD` diff.

Anvil never resets the repository, cleans user files, stages changes, commits, or pushes.

## Safety invariants

A run cannot reach `DONE` (**Sealed**) unless all of these are true:

1. current workspace revision equals the revision recorded by the run;
2. checks have a passing result for that exact revision and effective config;
3. security has a passing result for that exact revision and policy;
4. review has a passing result for that exact revision and policy;
5. no blocking findings remain open;
6. any configured budgets and transition limits were not exceeded.

Security and review are read-only by contract and by before/after fingerprint verification. A mutation invalidates the result and routes the run back through Warden.

Full baseline and target snapshots are stored locally with the run artifacts, so large repositories require corresponding disk space. Snapshot preparation rejects unsupported or ambiguous states, including submodules, unresolved merges, skip-worktree/assume-unchanged entries, and text patches that cannot be rendered losslessly as UTF-8. See [revision evidence recovery](docs/troubleshooting.md#a-reviewer-cannot-inspect-the-revision-diff) for recovery limits.

## Token discipline

Handoffs contain:

- objective and plan artifact pointers;
- current revision and mutation epoch;
- active acceptance criteria;
- open finding IDs, summaries, and evidence references;
- changed-file names with a hard cap;
- bounded durable memory snippets.

Full logs remain artifacts. Full transcripts are never passed between workers. Historical attempts do not enlarge a current handoff when the open findings and revision stay constant.

## OMP compatibility boundary

The workflow engine depends on `AgentRunner`, `RevisionProvider`, and `CheckRunner`. OMP-specific discovery and child execution are isolated in `src/runners/omp-compat.ts` and `src/runners/omp-subprocess-runner.ts`.

The package follows the extension and task-agent concepts documented by OMP. Internal OMP signatures evolve, so only the compatibility adapter should need significant changes after an OMP upgrade.

## Development

```bash
deno task typecheck
deno task test
deno task build
```

The repository runs on Deno and standard Node-compatible APIs supplied by the OMP host. Unit and integration tests use injected fake agents and revision providers, so state-machine correctness does not spend model tokens.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
