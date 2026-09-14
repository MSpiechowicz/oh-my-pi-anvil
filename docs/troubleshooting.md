# Troubleshooting

Use `/forge` for all diagnostics and run management. `/orchestrate` is retained as an equivalent compatibility alias, so existing scripts can continue to call it while new usage should prefer `/forge`.

## `/forge doctor` reports a missing agent

Confirm that the four configured agent names are discoverable from the project or user OMP agent paths. Forge validates every role mapping before it spends model tokens. Check the `agents.planner`, `agents.implementation`, `agents.security`, and `agents.review` entries in `.omp/orchestrator.yml`.

## A run is blocked

Inspect the run and its findings:

```text
/forge status <run-id>
/forge findings <run-id>
```

Blocked runs include a typed reason. Common reasons include budget exhaustion, repeated attempts, schema errors, a read-only mutation, or an unavailable agent. Resolve the reported configuration, agent, or workspace issue before starting or resuming work.

## A run stopped during implementation

Resume the persisted run:

```text
/forge resume <run-id>
```

Forge recomputes the workspace fingerprint. If files changed, it records the new mutation epoch and starts at Warden checks. It never resets or cleans the repository.

## A gate says the revision is stale

The workspace changed after the gate ran. This is expected protection, not a repository repair action. Forge invalidates the old pass and reruns deterministic checks before security and review. Avoid treating a result from an earlier revision as evidence for the current files.

## The runtime directory is hard to find

The default runtime directory is `.omp/.orchestrator/`. This is an internal, historical storage name; it is not a second command or a separate setup step. It contains SQLite state and run artifacts. If the project sets `persistence.root`, inspect that configured location instead.
