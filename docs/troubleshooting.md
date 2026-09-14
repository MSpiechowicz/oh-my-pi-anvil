# Troubleshooting

## `/orchestrate doctor` reports a missing agent

Confirm the four configured agent names are discoverable from the project or user OMP agent paths. Anvil validates all role mappings before it spends model tokens.

## A run is blocked

Use `/orchestrate status <run-id>` and `/orchestrate findings <run-id>`. Blocked runs include a typed reason for budget exhaustion, repeated attempts, schema errors, read-only mutations, or an unavailable agent.

## A run stopped during implementation

Use `/orchestrate resume <run-id>`. Anvil recomputes the workspace fingerprint. If files changed, it records the new mutation epoch and starts at Warden checks. It never resets or cleans the repository.

## A gate says the revision is stale

The workspace changed after the gate ran. This is expected protection. The Forge invalidates the old pass and re-runs deterministic checks before security and review.
