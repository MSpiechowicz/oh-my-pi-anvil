# Configuration

Forge assembles an effective configuration before a run. The global user settings file is loaded by default, and an optional repository overlay can override it. The canonical project overlay is `.omp/anvil.yml`; `/forge` runs an objective and `/anvil` manages configuration, diagnostics, runs, and updates.

## Configuration locations and precedence

Settings are merged in this order:

1. built-in `DEFAULT_CONFIG`;
2. the global user file, `$XDG_CONFIG_HOME/omp/anvil.yml`;
3. the nearest project overlay, `.omp/anvil.yml`.

If `XDG_CONFIG_HOME` is not set, the global Anvil path is `~/.config/omp/anvil.yml`. OMP's global model-role mappings are stored in `~/.omp/agent/config.yml` by default, or in `$PI_CODING_AGENT_DIR/config.yml` when a custom agent directory is active. Named profiles use their profile agent directory. Both configuration files are editable YAML. The Anvil global file is optional; when it is absent, Forge continues with built-in defaults.

On the first OMP session after installation, Anvil automatically creates the Anvil global file if it is missing and shows a notification with the exact path to edit. A new OMP session or restart of OMP is required after installation so Anvil can load and perform this setup. It does not modify the current repository during this automatic setup. Existing global settings are left unchanged, so the notification is not repeated on later sessions.

Inspect the active paths and verify the installation:

```text
/anvil config
/anvil doctor
/anvil init
/anvil update check
```


Initialization creates the missing global file and, at the repository root, creates a small editable `.omp/anvil.yml` overlay. It never overwrites existing global or project settings. Running initialization from a repository subdirectory still targets that repository root. If either file already exists, initialization reports it instead of replacing it.
`/anvil config` reports schema-valid settings as `STATUS VALID` even when the optional global file is absent. That does not establish execution readiness: Warden still needs explicit or automatically discovered checks before `/forge` can proceed. It also marks the global file and project overlay as `present` or `not present`; run `/anvil init` when this repository needs its `.omp/anvil.yml` overlay.


The generated project overlay is intentionally sparse so shared global values continue to apply. Add only repository-specific overrides, for example:

```yaml
# $XDG_CONFIG_HOME/omp/anvil.yml
agents:
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

Here the project-specific agent replaces the global implementation agent, and the project `checks` list is the repository's configured checks list. Other global and default settings remain in effect.

## Warden verification requirements

Warden is a command runner, not a model agent. After merging defaults, global settings, and the project overlay, Forge automatically discovers supported verification commands when the effective `checks` list is empty. A nonempty explicit list is preserved unchanged and disables discovery. A project `checks: []` replaces inherited checks and requests discovery rather than disabling verification.

Discovery only reads project manifests and lockfiles; it does not execute scripts during configuration loading or write discovered checks into either settings file. The discovered list becomes part of the effective configuration before validation, hashing, and planning. If it is still empty, a run stops with `CONFIG_INVALID` before any model invocation instead of recording an empty passing gate. For unsupported projects, configure executable commands explicitly.

Discovery supports these root manifests, not a recursive workspace scan:

- **`package.json` scripts:** verification names such as `check`, `typecheck`, `type-check`, `type_check`, `lint`, `test`, and `build`, including conventional colon-, hyphen-, or underscore-separated variants. Only nonempty commands without detected watch, development-server, interactive UI, or mutation modes are eligible; watch/dev/serve/start/fix/format/write/update variants are excluded.
- **`deno.json` or `deno.jsonc` tasks:** the same verification-name and finite-command rules apply. `deno.json` takes precedence over `deno.jsonc`. Native Deno tasks take precedence over same-name package scripts, and package wrappers for those tasks are not duplicated.
- **Package-manager choice:** a recognized `packageManager` declaration (`npm`, `pnpm`, `yarn`, or `bun`) wins. When that declaration is absent, Forge checks lockfiles in this order: `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`/`bun.lockb`, then `package-lock.json`/`npm-shrinkwrap.json`; without a match it uses `npm`. An invalid or unsupported declaration causes `CONFIG_INVALID` instead of silently choosing another manager. Deno tasks use `deno task`.
- **Finite command filtering:** simple commands and `&&` chains are supported. Opaque shell constructs such as command substitution, background execution, pipelines, and redirection, as well as known watch/process orchestrators and unsafe flags, are excluded. Referenced scripts and package lifecycle hooks are inspected too.
- **One-shot tests:** a direct bare Vitest command receives `run`; Vitest with options receives `--run`; a direct Jest command receives `--ci`. npm forwards these arguments through `--`. Wrappers that would need runner arguments injected into a nested command are skipped in favor of discovering the eligible leaf script. Explicit watch or mutation modes are excluded rather than silently run. Discovery is a conservative filter, not a sandbox or a proof that arbitrary script bodies and their dependencies are safe.
- **Check definitions:** IDs are the original script/task names, such as `check`, `test`, or `test:unit`, with `required: true` and `timeoutMs: 180000`. Deno tasks appear in name order, followed by unmatched package scripts in name order.
- **Manifest errors:** missing optional manifests are ignored, but malformed manifests or invalid script/task entries cause `CONFIG_INVALID`. An explicit nonempty checks list bypasses discovery, including these manifest checks.

At least one effective check must be required, either through `required: true` or Architect's `requiredChecks`. Architect receives the effective IDs, including discovered checks; an unknown plan-required ID or a plan with no effective required check is rejected before Smith starts. A plan-required check is authoritative even if its configured `required` flag is false: its failure stops the gate and participates in fail-fast behavior. Browser/manual verification belongs in acceptance criteria and Smith's verification evidence, not an invented Warden command ID.

To override discovery for a repository that exposes Yarn `check` and `build` scripts, a project overlay can use:

```yaml
checks:
  - id: typecheck
    command: [yarn, check]
    required: true
    timeoutMs: 180000
  - id: build
    command: [yarn, build]
    required: true
    timeoutMs: 180000
```

Choose commands appropriate for the repository; avoid watch-mode commands. A project `checks` list replaces, rather than appends to, the inherited list. Changing checks changes workflow policy, so configure them before starting a new run; an old run cannot adopt changed check policy through budget-only resume.

## Workflow and command surface

The V1 workflow is fixed in the implementation. Configuration selects the specialists and gates; it does not redefine the state machine:

```mermaid
flowchart LR
    A[Architect] --> S[Smith]
    S --> W[Warden<br/>exact revision]
    W --> T[Sentinel<br/>exact revision]
    T --> I[Inquisitor<br/>exact revision]
    I --> Z[Sealed]
    W -- failure --> S
    T -- blocking finding --> S
    I -- blocking finding --> S
```

Use `/forge` with the objective itself as the start point:

```text
/forge "Describe the change to make"
```

Use `/anvil` for configuration and run management:

```text
/anvil config
/anvil doctor
/anvil init
/anvil status [run-id]
/anvil resume <run-id>
/anvil findings [run-id]
/anvil cancel <run-id>
/anvil update check|install
```


## Configuration responsibilities

The V1 configuration controls:

- `version` and the named workflow;
- agent mappings for Architect, Smith, Sentinel, and Inquisitor;
- deterministic Warden checks, requiredness, and per-check timeouts;
- Sentinel and Inquisitor policies and retry limits;
- Smith retry limits;
- optional total and per-role token caps, plus request, transition, and wall-clock budgets;
- handoff and durable-memory limits;
- persistence options and safety flags.

Model and provider choices default to the host OMP model-role settings. Before starting a run, Anvil snapshots each agent's `model` and `thinkingLevel` into `effective-config.json` and uses those values for child execution. Explicit Anvil agent settings win; otherwise models inherit OMP per-agent overrides, named model roles, agent definitions, then the default model. Thinking inherits a model suffix, the agent definition, or OMP's `defaultThinkingLevel`. Anvil does not select a provider for you. The default agent definitions use the canonical role aliases:

```yaml
modelRoles:
  architect: "provider/planner:xhigh"
  smith: "provider/coding:xhigh"
  sentinel: "provider/security:xhigh"
  inquisitor: "provider/review:high"
```

Warden runs deterministic checks and has no model role. Agent mappings point to discoverable OMP agent names:

```yaml
agents:
  planner: # Architect
    agent: architect
  implementation: # Smith
    agent: smith
  security: # Sentinel
    agent: sentinel
  review: # Inquisitor
    agent: inquisitor
```

All four configured names are checked by `/anvil doctor` and at Forge run startup. A missing agent is reported before model work begins.

Override either value in the global Anvil file or a project overlay:

```yaml
agents:
  implementation:
    agent: smith
    model: "provider/coding"
    thinkingLevel: high
```

An explicit `thinkingLevel` wins over a model's `:thinking` suffix, including `off`. Omitted fields inherit independently. The existing `effort` setting is passed to OMP as its per-spawn effort hint and can further adjust thinking according to the model and OMP's effort ceiling. Saved configuration records requested settings; agent output artifacts record the actual resolved model and thinking level, including host fallbacks. Existing run artifacts are not rewritten. Changes to these settings are subject to the same resume policy as other non-budget configuration.

## Optional token limits

Total and per-role token caps are disabled by default. Token usage is still recorded, including cache reads reported by OMP; it is separate from your provider's remaining subscription allowance. Request, transition, wall-clock, and attempt guardrails remain enabled.

Set a positive numeric cap only when you want one. Omitted values inherit a configured global cap; use `null` in the project overlay to disable it:

```yaml
budgets:
  maxTotalTokens: null
  perRole:
    planner:
      maxTokens: null
    implementation:
      maxTokens: null
    security:
      maxTokens: null
    review:
      maxTokens: null
```

Budgets are checked between stages and before another role attempt, not during individual model calls. An attempt can therefore exceed an explicitly configured cap before the run pauses.

If a run pauses on a budget, raise or remove the relevant cap and use `/anvil resume <run-id>`. Resume applies the current `budgets` settings while preserving all accumulated usage, attempts, and completed work. If another configured cap remains exhausted, the run stays paused and reports that blocker. Pausing and unblocking do not consume workflow transitions.

Other workflow settings must still match the saved effective configuration; budget changes do not invalidate prior gate evidence or authorize changes to checks and review policy.

## Revision and gate behavior

Smith is the mutating stage. Every source mutation invalidates prior gates and starts Warden again. Sentinel and Inquisitor must keep repository files unchanged; before-and-after revision checks reject a reviewer mutation.

Verification-only Smith work may reuse Warden and Sentinel passes only when the exact revision, mutation epoch, configuration, policy, and recorded evidence dependencies remain valid, without relevant open findings or a later failed/blocked gate. The gate that raised a finding runs again. Sentinel defaults to depending on Smith verification; only an explicit `verificationIndependent: true` permits reuse after successful verification additions. Reuse also requires an explicit `liveValidation: false`: live or unknown external-state dependence is never inferred away from source identity. Missing or changed dependencies reject reuse rather than weakening verification.

The bundled reviewers have `bash` for scoped `curl`/`gh`, the optional native `github` tool, and `eval` for OMP's browser API. Browser validation starts with managed tabs rather than inherited authenticated sessions. These execution tools are not a read-only sandbox: reviewer instructions forbid repository changes and unauthorized remote writes. Source fingerprints detect repository changes, not remote side effects. Live HTTP/GitHub/browser results must be reported as live validation; they are not durable proof of future remote state.

## Persistence

Runtime state defaults to `.anvil/`. It contains SQLite state, the effective configuration, bounded handoffs, structured outputs, and command logs. Rendered prompts are not persisted by default.

You may set a different persistence root through the `persistence.root` option. Runtime files are kept separate from the workspace revision; source edits remain subject to revision checks. See [Persistence and recovery](../README.md#persistence-and-recovery) for the runtime layout and recovery behavior.
