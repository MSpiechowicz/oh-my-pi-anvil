# Troubleshooting

Use `/forge` for all diagnostics and run management. Configuration is assembled from built-in defaults, the global `$XDG_CONFIG_HOME/omp/anvil.yml` file (or `~/.config/omp/anvil.yml` when `XDG_CONFIG_HOME` is unset), and the nearest project `.omp/orchestrator.yml` overlay. Project values win. `/orchestrate` is retained as an equivalent compatibility alias, so existing scripts can continue to call it while new usage should prefer `/forge`.

After installing Anvil, a new OMP session or restart of OMP is required so the extension loads. In that first session, Anvil creates the missing global settings template automatically and shows its exact path in an OMP notification. It does not modify the current repository during this automatic setup. If the global file already exists, it remains untouched and no setup notification is repeated.

Edit the global file, then verify the installation. From a repository, initialize the optional overlay:

```text
/forge doctor
/forge init
```

## Set up or inspect configuration

It creates the missing editable global file and creates `.omp/orchestrator.yml` at the repository root only when no canonical project file or alternate repository settings file is present; it never overwrites existing global, canonical, or alternate settings. Initialization from a repository subdirectory still updates the root's `.omp/orchestrator.yml` location. Initialization reports existing canonical settings and any alternate candidates it detects. When an alternate is detected without a canonical project file, project initialization is skipped and the alternate path is reported for migration or inspection:

The alternate candidates are:

```text
.omp/orchestrator.json
.omp/anvil.yml
.anvil.yml
anvil.yml
```


## `/forge doctor` reports a missing agent

Confirm that the four configured agent names are discoverable from the project or user OMP agent paths. Forge validates every role mapping before it spends model tokens. Check the effective `agents.planner`, `agents.implementation`, `agents.security`, and `agents.review` entries: shared mappings usually belong in `$XDG_CONFIG_HOME/omp/anvil.yml` (or `~/.config/omp/anvil.yml`), and repository-specific replacements belong in `.omp/orchestrator.yml`.

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
