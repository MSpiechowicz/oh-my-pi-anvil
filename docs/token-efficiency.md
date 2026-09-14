# Token efficiency

Each role receives a bounded handoff with mandatory run/revision fields first, then artifact references, acceptance criteria, blocking findings, recent gate evidence, changed-file names, and optional durable memory.

Large command logs and structured reports remain artifacts. Historical events never enter a new prompt. The serializer caps inline characters and drops low-priority context before it truncates required identity or artifact pointers.

The workflow also avoids expensive gates when required deterministic checks fail. Usage counters are recorded per attempt and rolled into the run ledger.

Total and per-role token caps are optional and disabled by default. Recorded totals include cached tokens when reported by OMP and do not represent remaining provider allowance. Explicit caps pause a run at a stage boundary; raise or remove the cap and resume the same run to keep its completed work.
