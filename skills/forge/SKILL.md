---
name: forge
description: Use Forge for bounded planning, implementation, deterministic checks, security, and final review.
---

# Forge

After installing Anvil through the OMP marketplace, a new OMP session or restart of OMP is required so the extension loads. On that first session, Anvil creates the global configuration when missing and notifies you of its exact path. Edit that file, run `/forge doctor`, then run `/forge init` from a repository to create its overlay.

Use the explicit `/forge` command as the bounded workflow surface:

- `/forge start <objective>` starts a Forge run.
- `/forge status [run-id]` shows exact state, revision, gates, findings, and usage.
- `/forge resume <run-id>` recovers a run from SQLite and artifacts.
- `/forge findings [run-id]` renders open and resolved findings.
- `/forge cancel <run-id>` requests cancellation.
- `/forge doctor` checks setup without model calls.

The legacy `/orchestrate` command remains an equivalent compatibility alias.

Configure `.omp/orchestrator.yml`. Map the logical planner, implementation, security, and review roles to OMP agent names. Model selection stays in normal OMP model-role configuration. Runtime state is stored under `.omp/.orchestrator/`.

Forge never forwards a full conversation transcript. Workers receive bounded structured handoffs and artifact references. Any implementation mutation invalidates earlier gates and must pass Warden, Sentinel, and Inquisitor again.
