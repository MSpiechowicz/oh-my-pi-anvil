---
name: forge
description: Run Forge's bounded Architect, Smith, Warden, Sentinel, and Inquisitor workflow.
---

# Forge

After installing Anvil through the OMP marketplace, a new OMP session or restart of OMP is required so the extension loads. On that first session, Anvil creates the global configuration when missing and notifies you of its exact path. Edit that file, run `/anvil doctor`, then run `/anvil init` from a repository to create its overlay.

Use `/anvil` for setup, diagnostics, run management, and updates:
When used without arguments in an interactive OMP session, `/anvil` opens a menu for these management areas.

- `/anvil config` shows the global Anvil config path, global OMP model mapping path, project overlay, and runtime state path.
- `/anvil doctor` checks setup without model calls.
- `/anvil init` creates missing configuration files.
- `/anvil status [run-id]` shows exact state, revision, gates, findings, and usage.
- `/anvil resume <run-id>` recovers a run from SQLite and artifacts.
- `/anvil findings [run-id]` renders open and resolved findings.
- `/anvil cancel <run-id>` requests cancellation.
- `/anvil update check|install` checks or installs a managed update.

Use `/forge <objective>` as the bounded workflow surface. The objective text starts the Forge run; there is no `start` subcommand.

Configure `.omp/anvil.yml`. Map the logical Architect, Smith, Sentinel, and Inquisitor roles to OMP agent names. Warden runs deterministic checks and has no model. Model selection stays in normal OMP model-role configuration. Runtime state is stored under `.omp/.anvil/`.

Forge never forwards a full conversation transcript. Workers receive bounded structured handoffs and artifact references. Any implementation mutation invalidates earlier gates and must pass Warden, Sentinel, and Inquisitor again.
