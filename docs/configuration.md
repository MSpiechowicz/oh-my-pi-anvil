# Configuration

Anvil reads `.omp/orchestrator.yml` and validates version, role mappings, check IDs, severity policy, timeouts, budgets, context caps, and safety flags.

The V1 workflow is fixed:

```text
PLAN -> IMPLEMENT -> CHECKS -> SECURITY -> REVIEW -> DONE
```

Failures and findings route back through `IMPLEMENT`; all configured required checks run again after every implementation mutation. Model/provider choices remain in the host OMP model-role settings.

Runtime state defaults to `.omp/.orchestrator/`. It contains SQLite state, effective configuration, bounded handoffs, structured outputs, and command logs. Rendered prompts are not persisted by default.
