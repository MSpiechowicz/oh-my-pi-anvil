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

## Watch a running Forge

Interactive OMP sessions show one themed Forge progress panel above the input while `/forge` runs, with a blank line separating the panel from the editor. The panel shows a shortened run ID and a vertical timeline through Architect, Smith, Warden, Sentinel, and Inquisitor, with aligned activity descriptions on the right. Checkmarks identify completed stages, an animated spinner follows the active stage down the timeline, and an exclamation mark identifies an interrupted stage. Progress is not repeated below the input; hosts without widgets use a single status or working-message fallback. The spinner is only presentation; the persisted SQLite state remains authoritative. Use `/anvil status` for full run IDs and details.

Forge also refreshes the workspace lock heartbeat during long runs. If a previous OMP process left a lock after a run paused or reached a terminal state, the next Forge command checks that persisted state and safely reclaims the lock. A live run remains protected; inspect it with `/anvil status <run-id>` instead of deleting `lock.json`.

## A run is blocked

Inspect the run and its findings:

```text
/anvil status <run-id>
/anvil findings <run-id>
```

Blocked and failed runs include a typed reason. Common reasons include budget exhaustion, repeated attempts, schema errors, a read-only mutation, or an unavailable agent. Schema errors identify the role and failing field, such as `Smith output /claimedChangedFiles`. Forge uses the same complete output schemas for OMP and local validation; do not disable strict validation to work around a malformed report.

`BLOCKED` means paused, not terminal. Resolve the reported issue, then run `/anvil resume <run-id>`. Forge recovers the blocked stage from its event history, preserving the plan, completed attempts, workspace changes, and usage. A run blocked before Warden resumes at Warden rather than starting Architect and Smith again. Workspace changes still invalidate stale gate evidence.

Token caps are disabled by default. If you explicitly configured a total or per-role token cap, raise it or set it to `null` before resuming. Current budget settings apply to the existing run, but counters are never reset; unchanged exhausted limits keep the run paused. Other workflow settings must match the saved configuration. See [Optional token limits](configuration.md#optional-token-limits).

`DONE`, `FAILED`, and `CANCELLED` remain terminal. Resuming one shows its status without restarting stages. A paused run can also be cancelled with `/anvil cancel <run-id>`.

## A run stopped during implementation

Resume the persisted run:

```text
/anvil resume <run-id>
```

Forge recomputes the workspace fingerprint. If files changed, it records the new mutation epoch and starts at Warden checks. It never resets or cleans the repository.

## Warden has no checks or a required check is missing

Configure executable check IDs in `.omp/anvil.yml` or the global settings before starting a run. Empty checks stop with `CONFIG_INVALID` before any model call. Architect's `requiredChecks` must refer to configured IDs; at least one configured or plan-selected check must be required. A package script or a check name mentioned in prose does not configure Warden. Put browser/manual obligations in acceptance criteria and provide verification evidence separately.

Changing check configuration changes workflow policy. Preserve existing source work, fix the overlay, and start a new run describing only what remains; budget-only resume cannot adopt new check commands. See [Warden verification requirements](configuration.md#warden-verification-requirements).

## A gate says the revision is stale

The workspace changed after the gate ran. This is expected protection, not a repository repair action. Forge invalidates the old pass and reruns deterministic checks before security and review. Avoid treating a result from an earlier revision as evidence for the current files.

## A reviewer cannot inspect the revision diff

Anvil supplies a readable `changes.patch` and `manifest.json` through each review handoff's `review-diff` and `review-diff-manifest` evidence pointers. The manifest identifies both revision IDs and HEADs and links durable snapshots. Reviewers should read those artifacts rather than reconstruct compressed Git objects. Sentinel and Inquisitor can also use scoped `curl`/`gh` and browser validation, but those tools do not repair a missing historical baseline.

New runs capture `artifacts/revisions/baseline.json` before the first agent runs. This preserves pre-existing dirty and untracked content; the review patch describes changes from that actual baseline, even if implementation moves `HEAD`. The configured runtime directory is excluded. Snapshots contain full source bytes and can be large; protect them like the repository itself.

On resume, an older run without its baseline artifact is recoverable only when its saved fingerprint proves a clean historical commit still available in Git, or when the current workspace exactly matches the requested strengthened baseline identity. Anvil does not infer missing dirty bytes from `HEAD`, a current checkout, or a changed-file list. If the original baseline cannot be recovered, keep the existing work and start a new `/forge <objective>` run describing what remains. Do not edit SQLite revision IDs or reset the repository to force acceptance.

Missing, corrupt, or unsupported evidence blocks before a security/review attempt is charged. A corrupt artifact must be restored rather than silently replaced. Snapshot preparation also rejects submodules, unresolved index entries, skip-worktree/assume-unchanged paths, and non-UTF-8 text diffs that would be lossy; resolve the reported limitation before starting or resuming a supported run. Binary bytes remain preserved in snapshots and binary patches, but reviewers must state any inspection limits.

Reviewer handoffs also carry persisted Smith results, revision-bound verification evidence, real finding artifacts, and current Warden results. Smith should record targeted observations as `passed`, `failed`, or `not_run`; missing verification is never treated as passed. Supporting files must be run-root-relative and are captured into hash-checked attempt artifacts. Reviewers should inspect that evidence before requesting repeat work. They may perform targeted live checks with the available execution tools, but may not mutate source or remote resources without authorization.

## The runtime directory is hard to find

The default runtime directory is `.omp/.anvil/`. It contains SQLite state and run artifacts. If the project sets `persistence.root`, inspect that configured location instead.

## Release publishing reports a dirty checkout

The release CLI permits CI to rebuild the tracked `extension.js` bundle, but rejects unrelated changed or untracked files. Git's porcelain status uses leading spaces to distinguish staged and unstaged changes; these must be preserved when checking the allowed artifact. A rebuild alone must not trigger `Release checkout must be clean`.

Run the release CLI regression checks with `python -m unittest discover -s test -p '*_test.py' -v`. They publish only to temporary local Git repositories and exercise release resumption without creating a GitHub release.
