# Upgrade notes

Anvil persists package version, workflow version, effective configuration hash, and gate policy hashes in run state and artifacts.

A resumed run must use the non-budget workflow configuration recorded at start. Current budget settings may raise or remove limits on an existing run without resetting its usage or attempts. If checks, agent mappings, or other workflow policy changes, restore the saved settings or start a new run rather than silently changing gate policy mid-run.

Token caps are now opt-in, and existing `BLOCKED` runs can resume from the stage recorded in their event history, including runs created by versions that treated blocking as terminal. Reload the updated extension before resuming; no manual SQLite or artifact edits are required.
