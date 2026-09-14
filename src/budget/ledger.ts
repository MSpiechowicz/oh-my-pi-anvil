import { AnvilError } from "../util/errors.ts";
import { ROLE_LABELS } from "../agents/roles.ts";
import type { AgentRole, RunRecord, WorkflowConfig } from "../workflow/types.ts";

export class BudgetManager {
  constructor(private readonly config: WorkflowConfig) {}
  assertMayContinue(run: RunRecord): void {
    const limits = this.config.budgets;
    if (limits.maxTotalTokens !== undefined && run.usedTokens >= limits.maxTotalTokens) throw new AnvilError("BUDGET_EXHAUSTED", "Total token budget exhausted");
    if (limits.maxTotalRequests !== undefined && run.usedRequests >= limits.maxTotalRequests) throw new AnvilError("BUDGET_EXHAUSTED", "Total request budget exhausted");
    if (limits.maxTransitions !== undefined && run.transitionCount >= limits.maxTransitions) throw new AnvilError("BUDGET_EXHAUSTED", "Workflow transition budget exhausted");
    if (limits.maxWallClockMs !== undefined && Date.now() - Date.parse(run.startedAt ?? run.createdAt) >= limits.maxWallClockMs) throw new AnvilError("BUDGET_EXHAUSTED", "Workflow wall-clock budget exhausted");
  }
  assertRoleMayRun(_run: RunRecord, role: AgentRole, attempts: number, roleTokens = 0): void { const rolePolicy = this.config.budgets.perRole[role]; if (rolePolicy?.maxAttempts !== undefined && attempts >= rolePolicy.maxAttempts) throw new AnvilError("MAX_ATTEMPTS_EXCEEDED", `${ROLE_LABELS[role]} attempt budget exhausted`); if (rolePolicy?.maxTokens !== undefined && roleTokens >= rolePolicy.maxTokens) throw new AnvilError("BUDGET_EXHAUSTED", `${ROLE_LABELS[role]} token budget exhausted`); }
}
