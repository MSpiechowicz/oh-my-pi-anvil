# Troubleshooting

Use `/anvil` for diagnostics, configuration, run management, and updates. Use `/forge <objective>` to start a Forge run. Configuration is assembled from built-in defaults, the global `$XDG_CONFIG_HOME/omp/anvil.yml` file (or `~/.config/omp/anvil.yml` when `XDG_CONFIG_HOME` is unset), and the nearest project `.omp/anvil.yml` overlay. Project values win.

After installing Anvil, a new OMP session or restart of OMP is required so the extension loads. In that first session, Anvil creates the missing global settings template automatically and shows its exact path in an OMP notification. It does not modify the current repository during this automatic setup. If the global file already exists, it remains untouched and no setup notification is repeated.

Edit or inspect the global file, then verify the installation. From a repository, initialize the optional overlay:

```text
/anvil config
/anvil doctor
/anvil init
```

## Set up or inspect configuration

It creates the missing editable global file and creates `.omp/anvil.yml` at the repository root. It never overwrites existing global or project settings. Initialization from a repository subdirectory still updates the root's `.omp/anvil.yml` location. Existing files are reported instead of replaced.

## `/anvil doctor` reports a missing agent

Confirm that the four configured agent names are discoverable from the project or user OMP agent paths. Forge validates every role mapping before it spends model tokens. The user-facing roles are Architect, Smith, Sentinel, and Inquisitor; Warden runs deterministic checks. Shared mappings usually belong in `$XDG_CONFIG_HOME/omp/anvil.yml` (or `~/.config/omp/anvil.yml`), and repository-specific replacements belong in `.omp/anvil.yml`.

If `/anvil doctor` reports `RUNTIME UNAVAILABLE`, the installed host is not exposing either the current OMP SDK bridge or the legacy subprocess compatibility methods. Reload the extension after updating OMP or Anvil, then run `/anvil doctor` again. Do not start `/forge` until the runtime reports `AVAILABLE`; the run will otherwise fail before the first model request.

## A run is blocked

Inspect the run and its findings:

```text
/anvil status <run-id>
/anvil findings <run-id>
```

Blocked runs include a typed reason. Common reasons include budget exhaustion, repeated attempts, schema errors, a read-only mutation, or an unavailable agent. Resolve the reported configuration, agent, or workspace issue before starting or resuming work.

## A run stopped during implementation

Resume the persisted run:

```text
/anvil resume <run-id>
```

Forge recomputes the workspace fingerprint. If files changed, it records the new mutation epoch and starts at Warden checks. It never resets or cleans the repository.

## A gate says the revision is stale

The workspace changed after the gate ran. This is expected protection, not a repository repair action. Forge invalidates the old pass and reruns deterministic checks before security and review. Avoid treating a result from an earlier revision as evidence for the current files.

## The runtime directory is hard to find

The default runtime directory is `.omp/.anvil/`. It contains SQLite state and run artifacts. If the project sets `persistence.root`, inspect that configured location instead.
