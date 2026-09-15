# Upgrade notes

Anvil persists package version, workflow version, effective configuration hash, and gate policy hashes in run state and artifacts.

A resumed run must use the execution policy recorded at start. Current budget settings may raise or remove limits without resetting usage or attempts. Pre-run clarification settings may also differ: resume never repeats intake. If checks, agent mappings, or other execution policy changes, restore the saved settings or start a new run rather than silently changing gate policy mid-run.

Forge now defaults to repo-aware clarification before execution (`clarification.mode: auto`, `maxRounds: 2`). Use `/forge --clarify=always <objective>` for deliberate discovery or `--clarify=off` for a prepared objective. Interviews require explicit brief approval; noninteractive calls with unresolved decisions stop without starting a run. Intake records and usage survive ordinary completion, cancellation, and failure; accepted intake costs count toward the run budget. Existing configurations inherit the defaults without rewriting user files. Runs saved before the clarification field existed remain resumable when their execution policy matches; no historical artifact or gate hash is relabeled.

Run directories now include a human-readable `metadata.json` snapshot with UTC timestamps, objective, state, failure details, and the resume command. New runs create it automatically; existing runs acquire it on resume or cancellation. No database migration or configuration change is needed. Metadata is advisory and refreshed at lifecycle boundaries, not a replacement for SQLite or proof that a recorded running process is still alive.

Resource caps are now opt-in: total/per-role tokens and requests, role attempts, transitions, elapsed time, plan generations, and discovered-check timeouts default to `null`. `implementation.maxParallel` remains `4`. Explicit existing caps are preserved; clear them with `null` if desired. New global configurations expose the complete supported shape.

Move `implementation.maxAttempts`, `security.maxAttempts`, `review.maxAttempts`, and `planning.maxAttempts` to `budgets.perRole.implementation.maxAttempts`, `budgets.perRole.security.maxAttempts`, `budgets.perRole.review.maxAttempts`, and `budgets.perRole.planner.maxAttempts`, respectively. Old duplicate keys are rejected rather than silently combining two caps. Planner's role cap counts both plan production and repair decomposition.

Canonical null fields and removed duplicate keys change configuration identity. A run created under the old schema may need an explicit integrity-preserving migration or a new run; budget-only resume does not migrate its historical policy. Never edit artifact bytes or relabel historical gates to bypass a hash mismatch. Load the updated extension before using the new schema.

Scout reconnaissance and Archivist lesson curation are now enabled by default. Set `scouting.enabled: false` to skip reconnaissance before planning; set `memory.archivist: false` to skip curation before sealing. Archivist also requires `memory.enabled` and `memory.retainOnSuccess`, both true by default. Existing explicit `false` overrides are preserved. Agent mappings default to `scout` and `archivist`; only enabled roles are required during discovery.

Optional-role attempts and reports are persisted and budgeted independently of Architect and Inquisitor. Memory failures are advisory, and Smith lessons are recovered from persisted evidence rather than process-local state. Scout mutations stop the run; Archivist mutations invalidate the revision gates and require verification again.

The effective configuration now includes the optional role mappings and flags. Runs saved before these fields existed can fail the existing configuration-hash guard after upgrading; start a new run rather than editing saved run state or relabeling old gates.
