# Token efficiency

Each role receives a bounded handoff with mandatory run/revision fields first, then artifact references, acceptance criteria, blocking findings, recent gate evidence, changed-file names, and optional durable memory.

Large command logs and structured reports remain artifacts. Historical events never enter a new prompt. The serializer caps inline characters and drops low-priority context before it truncates required identity or artifact pointers.

The workflow also avoids expensive gates when required deterministic checks fail. Usage counters are recorded per attempt and rolled into the run ledger.

## What the token budget measures

Total and per-role token caps are optional and disabled by default. The ledger consumes the executor-reported aggregate: each attempt uses its reported total when available, otherwise input plus output (missing values contribute zero). It does **not** universally compute input + output + cache-read + cache-write.

The host's aggregate can include cached context, so a run with little newly generated output can still consume a large token budget. These counters measure neither monetary cost nor remaining provider allowance; cache pricing does not reduce the recorded aggregate.

`/anvil status <run-id>` shows recorded tokens consumed against the run's token limit, plus separate input, output, cache-read, and cache-write counters. Treat those components as supporting evidence, not a reconstruction of the total. Reporting can be incomplete: the ledger stores unreported components as zero, so zero does not prove there was no usage. Components need not sum to the aggregate. Per-role caps use only that role's attempt aggregates; the run-wide cache breakdown must not be attributed to one role.

## When a cap pauses a run

Limits are checked between stages, before further work starts; they do not hard-interrupt an in-flight child. A child can therefore finish with recorded usage at or above the cap, and the next budget check pauses the run. Reaching the limit exactly is enough to exhaust it.

Token-exhaustion details record the consumed amount and ceiling, explain cache-inclusive accounting, and identify the relevant configuration key: `budgets.maxTotalTokens` or `budgets.perRole.<role>.maxTokens`. Review the recorded usage and configured cap. If continued work is appropriate, raise or remove that cap and use `/anvil resume <run-id>` to retain completed work. Changing the cap does not reset usage.

Resource caps are opt-in and default to `null`; concurrency remains limited by `implementation.maxParallel` (default `4`). Explicitly configured caps use the accounting above. Safety and verification gates are unchanged.
