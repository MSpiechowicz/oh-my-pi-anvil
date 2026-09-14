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

Anvil is a stateful multi-agent orchestrator for `oh-my-pi`. It delegates planning to the **Architect**, implementation to the **Smith**, deterministic verification to the **Warden**, security review to the **Sentinel**, and final engineering review to the **Inquisitor**.

Unlike prompt-only agent chains, Anvil's **Forge** is a deterministic, persistent workflow engine. Findings route back to the Smith, every code mutation invalidates earlier verification, and a run is only **Sealed** when checks, security, and review pass the exact same workspace revision.

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

```text
OBJECTIVE
    |
    v
ARCHITECT  -> strict plan.json
    |
    v
SMITH      -> repository mutation
    |
    v
WARDEN     -> configured deterministic checks
    |  fail
    +------------------------------+
    |                               |
    +--------------------------> SMITH
    |
    | pass
    v
SENTINEL   -> read-only security gate
    | findings                 | pass
    +--------------------------> SMITH
                                  |
                                  v
INQUISITOR -> read-only final review
    | findings                 | pass + exact gates
    +--------------------------> SMITH
                                  |
                                  v
                               SEALED
```

The crucial rule is the correction loop. A review fix never jumps directly back to review:

```text
review finding -> Smith -> Warden -> Sentinel -> Inquisitor
security finding -> Smith -> Warden -> Sentinel -> Inquisitor
```

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

Install the package through the OMP package mechanism, then expose the bundled extension and agents. In a project, create `.omp/orchestrator.yml` and map the model roles in normal OMP configuration.

```bash
# from an OMP project
/orchestrate doctor
/orchestrate start "Add scoped API-key rotation with a backwards-compatible migration"
/orchestrate status
```

If the process stops, resume from persisted state:

```bash
/orchestrate resume run_<id>
```

Inspect findings without opening SQLite:

```bash
/orchestrate findings run_<id>
```

## Marketplace installation and updates

Register the Anvil marketplace and install the stable release through OMP:

```bash
omp plugin marketplace add MSpiechowicz/oh-my-pi-anvil
omp plugin install oh-my-pi-anvil@omp-anvil --scope user
```

Anvil exposes the same native update path from inside OMP:

```text
/orchestrate update check
/orchestrate update install
```

The standalone command-line entrypoint is also available when the package is on your `PATH`:

```bash
anvil-update check
anvil-update install
```

Updates verify the published stable GitHub release, refresh the registered marketplace, upgrade only the active unambiguous Anvil installation, and confirm that OMP installed a newer version. Source checkouts are never overwritten; update those with `git pull --ff-only`, then run `npm install && npm run build`.

## Configuration

The V1 workflow is intentionally fixed. Configuration controls specialists, deterministic checks, policies, budgets, persistence, and memory, while the state machine remains code-owned.

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
    command: [bun, run, typecheck]
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

The default agent definitions reference these aliases. Anvil never chooses a provider for you.

## Persistence and recovery

Runtime state lives under `.omp/.orchestrator/` by default:

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

A run cannot reach `DONE` unless all of these are true:

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
npm install
npm run typecheck
npm test
npm run build
```

The repository has no runtime dependency beyond the Bun APIs supplied by the OMP host. Unit and integration tests use injected fake agents and revision providers, so state-machine correctness does not spend model tokens.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
