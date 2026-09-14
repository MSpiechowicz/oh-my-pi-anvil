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

Anvil is an OMP extension for taking a software objective from a written plan to a verified workspace revision. The user-facing command is **`/forge`**. Behind that command, Anvil runs a deterministic, persistent workflow engine that coordinates the **Architect**, **Smith**, **Warden**, **Sentinel**, and **Inquisitor**.

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

The lifecycle is deliberately linear between corrections. Each gate evaluates the exact current revision; a failure or blocking finding sends the run back to the Smith instead of allowing a stale pass to continue.

<p align="center">
  <img src="assets/diagrams/forge-lifecycle.svg" alt="Forge lifecycle: Architect plans, Smith mutates, Warden checks, Sentinel audits security, Inquisitor reviews, and Sealed is reached only when exact-revision gates pass." width="100%" />
</p>

The correction path is never a shortcut around verification:

<p align="center">
  <img src="assets/diagrams/forge-correction-loop.svg" alt="Forge correction loop: a failure or finding returns to Smith, then passes through Warden, Sentinel, and Inquisitor again." width="100%" />
</p>

Every Smith mutation starts the gate sequence again. Read-only gates also verify before-and-after workspace fingerprints, so a mutation during security or review cannot be mistaken for a pass.

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

## Quick start

Install Anvil through OMP. On the first OMP session, Anvil automatically creates the editable global settings template and shows its path in the OMP notification area; it does not modify the current repository during this first-run setup. Use `/forge init` when you also want a repository-specific overlay.

```bash
# Register the Anvil marketplace and install the stable release
omp plugin marketplace add MSpiechowicz/oh-my-pi-anvil
omp plugin install oh-my-pi-anvil@omp-anvil --scope user

# After opening a new OMP session, edit the global settings Anvil created:
$EDITOR "${XDG_CONFIG_HOME:-$HOME/.config}/omp/anvil.yml"

# Optional: from the repository where you want a project overlay. Running
# this from a subdirectory still targets the repository root.
/forge init
/forge doctor
/forge start "Add scoped API-key rotation with a backwards-compatible migration"
/forge status
```

The automatic first-run setup creates the global file at `$XDG_CONFIG_HOME/omp/anvil.yml` when `XDG_CONFIG_HOME` is set, or at `~/.config/omp/anvil.yml` otherwise. If the file already exists, startup leaves it unchanged and shows no repeated setup notification. `/forge init` creates the optional project overlay at the repository root as `.omp/orchestrator.yml` only when neither that canonical file nor an alternate repository settings file exists. Missing files are created as editable text; existing global, canonical, and alternate settings are preserved. If it detects an alternate and no canonical project file, project initialization is skipped and the alternate path is reported for inspection or migration.

Forge loads settings in this order, with later values taking precedence:

1. built-in defaults;
2. the global user file;
3. the nearest repository `.omp/orchestrator.yml` overlay.

The project overlay is intentionally small: put shared checks and agent choices in the global file, then add only repository-specific overrides to `.omp/orchestrator.yml`. `/orchestrate` remains an equivalent alias, including for initialization.

If the process stops, resume from persisted state:

```bash
/forge resume run_<id>
```

Inspect findings without opening SQLite:

```bash
/forge findings run_<id>
```


## Marketplace installation and updates

Register the Anvil marketplace and install the stable release through OMP:

```bash
omp plugin marketplace add MSpiechowicz/oh-my-pi-anvil
omp plugin install oh-my-pi-anvil@omp-anvil --scope user
```

Anvil exposes the native update path from inside OMP:

```text
/forge update check
/forge update install
```

The standalone command-line entrypoint is also available when the package is on your `PATH`:

```bash
anvil-update check
anvil-update install
```

Updates verify the published stable GitHub release, refresh the registered marketplace, upgrade only the active unambiguous Anvil installation, and confirm that OMP installed a newer version. Source checkouts are never overwritten; update those with `git pull --ff-only`, then run `deno task build`.

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

The optional repository-specific overlay is:

```text
<repository-root>/.omp/orchestrator.yml
```

For example, keep common agent mappings and checks in the global file, then customize one repository with a small overlay:

```yaml
# $XDG_CONFIG_HOME/omp/anvil.yml
agents:
  planner:
    agent: orchestrator-planner
  implementation:
    agent: orchestrator-implementation
checks:
  - id: typecheck
    command: [deno, task, typecheck]
    required: true
    timeoutMs: 180000
```

```yaml
# <repository-root>/.omp/orchestrator.yml
# Values here override the global settings for this repository.
agents:
  implementation:
    agent: my-repository-implementation
checks:
  - id: lint
    command: [deno, task, lint]
    required: true
    timeoutMs: 120000
```

An overlay can contain only the fields it needs. In this example, the project `checks` list replaces the inherited list, while the other global and default values remain in effect.

The complete configuration shape is:

```yaml
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

checks:
  - id: typecheck
    command: [deno, task, typecheck]
    required: true
    timeoutMs: 180000

security:
  failOn: [critical, high, medium]
  maxAttempts: 3

review:
  maxAttempts: 3

implementation:
  maxAttempts: 6

budgets:
  maxTotalTokens: 250000
  maxTotalRequests: 120
  maxTransitions: 40

context:
  maxInlineChars: 12000
  maxMemoryItems: 5

memory:
  enabled: true
  retainOnSuccess: true
```

Model selection stays separate in OMP:

```yaml
modelRoles:
  orch_plan: "provider/planner:xhigh"
  orch_impl: "provider/coding:xhigh"
  orch_security: "provider/security:xhigh"
  orch_review: "provider/review:high"
```

The default agent definitions reference these aliases. Anvil never chooses a provider for you. For the complete configuration reference, see [Configuration](docs/configuration.md).

## Persistence and recovery

Runtime state lives under `.omp/.orchestrator/` by default. This directory name is an internal, historical storage name; it does not change the `/forge` command.

```text
.omp/.orchestrator/
├── orchestrator.db
├── lock.json
└── runs/<run-id>/
    ├── objective.md
    ├── effective-config.json
    ├── plan.json
    ├── artifacts/
    │   ├── planner/
    │   ├── implementation/
    │   ├── checks/
    │   ├── security/
    │   └── review/
    └── logs/
```

SQLite is authoritative for workflow state. Artifacts are hashed and written atomically. Runtime files are excluded from the workspace revision; source edits are not.

Recovery is state-aware:

- interrupted planning reruns the planner;
- interrupted implementation recomputes the revision and runs checks if files changed;
- interrupted checks rerun checks;
- interrupted security or review reruns the read-only gate after revision validation.

Anvil never resets the repository, cleans user files, stages changes, commits, or pushes.

## Safety invariants

A run cannot reach `DONE` (**Sealed**) unless all of these are true:

1. current workspace revision equals the revision recorded by the run;
2. checks have a passing result for that exact revision and effective config;
3. security has a passing result for that exact revision and policy;
4. review has a passing result for that exact revision and policy;
5. no blocking findings remain open;
6. budgets and transition limits were not exceeded.

Security and review are read-only by contract and by before/after fingerprint verification. A mutation invalidates the result and routes the run back through Warden.

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
