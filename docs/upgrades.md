# Upgrade notes

Anvil persists package version, workflow version, effective configuration hash, and gate policy hashes in run state and artifacts.

A resumed run must use the effective configuration recorded at start. If the project config changes, start a new run rather than silently changing gate policy mid-run. Future migrations may add an explicit `--use-current-config` flow that invalidates all prior passes.
