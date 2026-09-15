# Upgrade notes

Anvil persists package version, workflow version, effective configuration hash, and gate policy hashes in run state and artifacts.

A resumed run must use the non-budget workflow configuration recorded at start. Current budget settings may raise or remove limits on an existing run without resetting its usage or attempts. If checks, agent mappings, or other workflow policy changes, restore the saved settings or start a new run rather than silently changing gate policy mid-run.

Resource caps are now opt-in: total/per-role tokens and requests, role attempts, transitions, elapsed time, plan generations, and discovered-check timeouts default to `null`. `implementation.maxParallel` remains `4`. Explicit existing caps are preserved; clear them with `null` if desired. New global configurations expose the complete supported shape.

Move `implementation.maxAttempts`, `security.maxAttempts`, `review.maxAttempts`, and `planning.maxAttempts` to `budgets.perRole.implementation.maxAttempts`, `budgets.perRole.security.maxAttempts`, `budgets.perRole.review.maxAttempts`, and `budgets.perRole.planner.maxAttempts`, respectively. Old duplicate keys are rejected rather than silently combining two caps. Planner's role cap counts both plan production and repair decomposition.

Canonical null fields and removed duplicate keys change configuration identity. A run created under the old schema may need an explicit integrity-preserving migration or a new run; budget-only resume does not migrate its historical policy. Never edit artifact bytes or relabel historical gates to bypass a hash mismatch. Load the updated extension before using the new schema.

Scout reconnaissance and Archivist lesson curation are now enabled by default. Set `scouting.enabled: false` to skip reconnaissance before planning; set `memory.archivist: false` to skip curation before sealing. Archivist also requires `memory.enabled` and `memory.retainOnSuccess`, both true by default. Existing explicit `false` overrides are preserved. Agent mappings default to `scout` and `archivist`; only enabled roles are required during discovery.

Optional-role attempts and reports are persisted and budgeted independently of Architect and Inquisitor. Memory failures are advisory, and Smith lessons are recovered from persisted evidence rather than process-local state. Scout mutations stop the run; Archivist mutations invalidate the revision gates and require verification again.

The effective configuration now includes the optional role mappings and flags. Runs saved before these fields existed can fail the existing configuration-hash guard after upgrading; start a new run rather than editing saved run state or relabeling old gates.
