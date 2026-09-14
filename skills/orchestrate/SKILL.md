---
name: orchestrate
description: Use Anvil when a change needs bounded planning, implementation, deterministic checks, security, and final review.
---

# Anvil

Use the explicit `/orchestrate` command for stateful work:

- `/orchestrate start <objective>` starts a Forge run.
- `/orchestrate status [run-id]` shows exact state, revision, gates, findings, and usage.
- `/orchestrate resume <run-id>` recovers a run from SQLite and artifacts.
- `/orchestrate findings [run-id]` renders open and resolved findings.
- `/orchestrate cancel <run-id>` requests cancellation.
- `/orchestrate doctor` checks setup without model calls.

Configure `.omp/orchestrator.yml`. Map the logical planner, implementation, security, and review roles to OMP agent names. Model selection stays in normal OMP model-role configuration.

The Forge never forwards a full conversation transcript. Workers receive bounded structured handoffs and artifact references. Any implementation mutation invalidates earlier gates and must pass Warden, Sentinel, and Inquisitor again.
