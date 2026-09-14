# Upgrade notes

Anvil persists package version, workflow version, effective configuration hash, and gate policy hashes in run state and artifacts.

A resumed run must use the non-budget workflow configuration recorded at start. Current budget settings may raise or remove limits on an existing run without resetting its usage or attempts. If checks, agent mappings, or other workflow policy changes, restore the saved settings or start a new run rather than silently changing gate policy mid-run.

Token caps are now opt-in, and existing `BLOCKED` runs can resume from the stage recorded in their event history, including runs created by versions that treated blocking as terminal. Reload the updated extension before resuming; no manual SQLite or artifact edits are required.

Scout reconnaissance and Archivist lesson curation are now enabled by default. Set `scouting.enabled: false` to skip reconnaissance before planning; set `memory.archivist: false` to skip curation before sealing. Archivist also requires `memory.enabled` and `memory.retainOnSuccess`, both true by default. Existing explicit `false` overrides are preserved. Agent mappings default to `scout` and `archivist`; only enabled roles are required during discovery.

Optional-role attempts and reports are persisted and budgeted independently of Architect and Inquisitor. Memory failures are advisory, and Smith lessons are recovered from persisted evidence rather than process-local state. Scout mutations stop the run; Archivist mutations invalidate the revision gates and require verification again.

The effective configuration now includes the optional role mappings and flags. Runs saved before these fields existed can fail the existing configuration-hash guard after upgrading; start a new run rather than editing saved run state or relabeling old gates.
