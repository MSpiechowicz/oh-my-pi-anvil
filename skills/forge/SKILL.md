---
name: forge
description: Run Forge's bounded Architect, Smith, Warden, Sentinel, and Inquisitor workflow.
---

# Forge

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

Use the global settings and optional `.omp/anvil.yml` overlay to map the logical Architect, Smith, Sentinel, and Inquisitor roles to OMP agent names. Warden runs deterministic checks and has no model. When the merged `checks` list is empty, Forge discovers supported finite verification scripts from root project manifests; a nonempty explicit list overrides discovery. Discovered checks affect only the effective configuration, never persisted settings. If discovery finds no supported checks, configure commands explicitly: Forge fails closed before model work. See `docs/configuration.md` for supported manifests and discovery rules. Model selection stays in normal OMP model-role configuration. Runtime state is stored under `.anvil/`.

Scout and Archivist are optional logical roles mapped by `agents.scout.agent` and `agents.archivist.agent` (defaults `scout` and `archivist`). Both flows default on. Set `scouting.enabled: false` to skip Scout or `memory.archivist: false` to skip Archivist. Scout performs one read-only reconnaissance attempt before Architect within `PLAN`. Archivist performs one read-only curation attempt after successful review and before sealing within `REVIEW`, only when `memory.enabled` and `memory.retainOnSuccess` are also true. Disabled optional agents are not discovered. Their attempts, outputs, and usage are persisted under their own roles and do not consume Architect or Inquisitor attempt limits.

Scout returns strict `ScoutOutput` JSON: `{ version: 1, summary: string, areas: Array<{ path: string, findings: string }>, risks: string[], recommendations: string[] }`. Its reconnaissance is advisory input to Architect, never plan approval. Archivist returns strict `ArchivistOutput` JSON: `{ version: 1, lessons: Array<{ content: string, importance: number }> }`, with at most 20 lessons, nonblank content no longer than 2000 characters, and importance from 0 to 1. These schemas are shared between host execution and local validation; unknown fields are rejected.

Archivist must curate persisted, revision-bound successful Smith evidence and its referenced objective, plan, and gate artifacts; do not infer successful work from volatile memory, a transcript, or unverified claims. Optional failures are advisory, but repository mutations invalidate earlier gates and must never allow sealing stale evidence.

Recalled memory is bounded by `context.maxMemoryItems` and `context.maxMemoryChars` and is non-authoritative context for Architect and Smith. Successful-run retention filters and deduplicates lessons, prioritizes importance, and caps saves with `memory.maxRetainedLessons`. Anvil uses OMP's native `context.memory.search` / `save` API when available; the host's configured backend owns storage. Absent/off/unsupported memory or provider failures never substitute for verification or prevent an otherwise correct workflow from completing. These flags do not activate an OMP backend.

Forge never forwards a full conversation transcript. Workers receive bounded structured handoffs and artifact references. Any implementation mutation invalidates earlier gates and must pass Warden, Sentinel, and Inquisitor again.

Architect may request bounded Smith fan-out through optional plan `smithTasks`, declaring task ownership, dependencies, and acceptance criteria. `implementation.maxParallel` defaults to 4; overlapping or dependent work stays sequential, and isolated execution is serialized. The same dispatch handles Warden, Sentinel, and Inquisitor repairs: gate-provided tasks are validated, otherwise Architect decomposes persisted open findings. The engine owns spawning, attempt accounting, and the completion barrier; roles must not spawn untracked workers. Gates inspect the combined revision only after all Smith work finishes.
