---
name: forge
description: Use Anvil's specialist agents for software development, debugging, planning, security audits, and code review. Select and spawn only the agents the task needs, or use the bounded Forge workflow for persisted execution and verification.
---

# Forge

## Choose the execution mode

Use this skill when a development task benefits from specialist planning, implementation, reconnaissance, security auditing, or review. Keep small, clear changes inline; do not spawn a full team for every request.

There are two distinct modes:

- **Session-led development:** the coordinating LLM uses OMP's `task` tool or Eval `agent()` to dispatch only the specialists needed. This is ordinary delegation, not a persisted Forge run.
- **Managed Forge:** the user invokes `/forge <objective>` to run Anvil's persistent engine with budgets, bounded dispatch, revision gates, and resumable state. `/forge` is an extension command, not a shell executable or a model-callable tool. Reading this skill or invoking `/skill:forge` does not execute that command.

Never claim that session-led work is Sealed or has passed Forge gates. If the user requested a managed run and no command-execution surface is available to the model, provide the exact `/forge <objective>` command rather than inventing a tool or running slash commands through Bash.

## Session-led agent selection

Use the agent names actually exposed by the host; installations can override or disable definitions. Default Anvil specialists are:

| Agent | Use when | Boundary |
| --- | --- | --- |
| `scout` | A bounded repository area needs reconnaissance before planning. | Read-only; return paths, findings, risks, and recommendations. |
| `architect` | A nontrivial change needs a concrete plan, acceptance criteria, or independent work packages. | Read-only; the coordinator owns dispatch. |
| `smith` | A defined implementation or repair task is ready. | Edits only its assigned files; does not spawn workers. |
| `sentinel` | The change exposes security-sensitive behavior or needs a security audit. | Read-only review of the actual revision, with evidence-backed findings. |
| `inquisitor` | Implementation needs correctness, maintainability, and acceptance review. | Read-only review; verify claims against the actual changes. |
| `archivist` | A successful managed run has persisted evidence worth retaining. | Read-only curation of revision-bound artifacts, not speculative transcript summaries. |

Warden is a deterministic check runner inside Forge, not an agent to spawn. For session-led work, the coordinator runs the repository's applicable checks after the editing agents finish.

Before dispatch, scope the work and define ownership and shared interfaces. Give each worker the objective, relevant paths and symbols, non-goals, dependencies, acceptance criteria, and available evidence. Supply the role's requested output schema when using Anvil's structured agent definitions; do not assume a worker has the parent conversation or a Forge runtime context.

Parallelize only independent tasks with disjoint ownership. Shared-file edits and dependent tasks stay sequential. Require concurrent writers to skip formatters, linters, builds, and project-wide tests; the coordinator runs those once after integration. Wait for every writer, inspect the combined result, run checks, then dispatch any necessary review. Repairs invalidate earlier verification. Workers must report unavailable verification honestly, never invent run IDs, artifacts, or gate results.

## Installation and discovery

Anvil ships this skill at `skills/forge/SKILL.md` in the plugin itself. Installing or updating Anvil installs or updates the skill together with the extension and agents; no separate skill installation or `/anvil init` is required. Start a new OMP session after installation or update so discovery and the model's skill metadata refresh. OMP exposes the skill as `skill://forge` and, when skill commands are enabled, `/skill:forge`.

If it is missing, inspect the enabled plugin and OMP skill filters. Disabled skills/providers, ignored skills, include-only filters, or a higher-precedence skill named `forge` can hide or override the bundled copy. Do not overwrite a user's separate skill to work around discovery settings.

## Managed Forge workflow

After installing Anvil through the OMP marketplace, a new OMP session or restart of OMP is required so the extension loads. On that first session, Anvil creates the global configuration when missing and notifies you of its exact path. Edit that file, run `/anvil doctor`, then run `/anvil init` from a repository to create its overlay.

Use `/anvil` for setup, diagnostics, run management, and updates:
When used without arguments in an interactive OMP session, `/anvil` opens a menu for these management areas.

- `/anvil config` shows the global Anvil config path, global OMP model mapping path, project overlay, and runtime state path.
- `/anvil doctor` checks setup without model calls.
- `/anvil init` creates missing configuration files.
- `/anvil status [run-id]` shows exact state, revision, gates, findings, and usage.
- `/anvil resume <run-id>` recovers a run from SQLite and artifacts.
- `/anvil findings [run-id]` renders open and resolved findings.
- `/anvil cancel <run-id>` requests cancellation.
- `/anvil update check|install` checks or installs a managed update.

Use `/forge [--clarify=auto|always|off] <objective>` as the bounded workflow surface; there is no `start` subcommand. Before creating a run, the default `auto` intake uses the configured Architect for read-only repository assessment and asks only about material unresolved decisions. A clear objective proceeds unchanged. `always` requires brief approval even without questions; `off` skips the intake model call for a prepared objective.

Intake generates independent questions in bounded rounds, presents consequences and recommendations, and supports custom answers and explicit unknown/prototype decisions. `clarification.maxRounds` defaults to 2 (range 1..10); reaching it requires continuation, scope narrowing, or cancellation, never implicit approval. Any interviewed brief requires explicit approval with no unresolved questions. Noninteractive calls stop if answers or approval are required. The workspace lock is held and repository mutations invalidate the assessment.

Standalone intake records under `.anvil/intake/` retain bounded decisions and usage on completion, cancellation, or failure. On execution, Forge copies the ready record to `artifacts/intake.json`, persists its execution objective as `objective.md`, and includes intake token/request usage in run totals without consuming planner attempts. Resume uses the saved objective and never re-interviews; changing pre-run clarification settings does not change execution policy.

Use the global settings and optional `.omp/anvil.yml` overlay to map the logical Architect, Smith, Sentinel, and Inquisitor roles to OMP agent names. Warden runs deterministic checks and has no model. When the merged `checks` list is empty, Forge discovers supported finite verification scripts from root project manifests; a nonempty explicit list overrides discovery. Discovered checks affect only the effective configuration, never persisted settings. If discovery finds no supported checks, configure commands explicitly: Forge fails closed before model work. See the installed Anvil package's `docs/configuration.md` for supported manifests and discovery rules (not a path in the user's repository or beneath `skill://forge`). Model selection stays in normal OMP model-role configuration. Runtime state is stored under `.anvil/`.

Scout and Archivist are optional logical roles mapped by `agents.scout.agent` and `agents.archivist.agent` (defaults `scout` and `archivist`). Both flows default on. Set `scouting.enabled: false` to skip Scout or `memory.archivist: false` to skip Archivist. Scout performs one read-only reconnaissance attempt before Architect within `PLAN`. Archivist performs one read-only curation attempt after successful review and before sealing within `REVIEW`, only when `memory.enabled` and `memory.retainOnSuccess` are also true. Disabled optional agents are not discovered. Their attempts, outputs, and usage are persisted under their own roles and do not consume Architect or Inquisitor attempt limits.

Scout returns strict `ScoutOutput` JSON: `{ version: 1, summary: string, areas: Array<{ path: string, findings: string }>, risks: string[], recommendations: string[] }`. Its reconnaissance is advisory input to Architect, never plan approval. Archivist returns strict `ArchivistOutput` JSON: `{ version: 1, lessons: Array<{ content: string, importance: number }> }`, with at most 20 lessons, nonblank content no longer than 2000 characters, and importance from 0 to 1. These schemas are shared between host execution and local validation; unknown fields are rejected.

Archivist must curate persisted, revision-bound successful Smith evidence and its referenced objective, plan, and gate artifacts; do not infer successful work from volatile memory, a transcript, or unverified claims. Optional failures are advisory, but repository mutations invalidate earlier gates and must never allow sealing stale evidence.

Recalled memory is bounded by `context.maxMemoryItems` and `context.maxMemoryChars` and is non-authoritative context for Architect and Smith. Successful-run retention filters and deduplicates lessons, prioritizes importance, and caps saves with `memory.maxRetainedLessons`. Anvil uses OMP's native `context.memory.search` / `save` API when available; the host's configured backend owns storage. Absent/off/unsupported memory or provider failures never substitute for verification or prevent an otherwise correct workflow from completing. These flags do not activate an OMP backend.

Forge never forwards a full conversation transcript. Workers receive bounded structured handoffs and artifact references. Any implementation mutation invalidates earlier gates and must pass Warden, Sentinel, and Inquisitor again.

Architect is instructed to return nonempty plan `smithTasks`, declaring task ownership, dependencies, and acceptance criteria; the schema also accepts plans without this optional field. `implementation.maxParallel` defaults to 4; overlapping or dependent work stays sequential, and isolated execution is serialized. The same dispatch handles Warden, Sentinel, and Inquisitor repairs: gate-provided tasks are validated, otherwise Architect decomposes persisted open findings. The engine owns spawning, attempt accounting, and the completion barrier; roles must not spawn untracked workers. Gates inspect the combined revision only after all Smith work finishes.
