import { AnvilError } from "../util/errors.ts";
import { ROLE_LABELS } from "../agents/roles.ts";
import type { AgentRole, RunRecord, WorkflowConfig } from "../workflow/types.ts";

export class BudgetManager {
  constructor(private readonly config: WorkflowConfig) {}
  assertMayContinue(run: RunRecord): void {
    const limits = this.config.budgets;
    if (limits.maxTotalTokens !== undefined && run.usedTokens >= limits.maxTotalTokens) throw new AnvilError("BUDGET_EXHAUSTED", `Total token budget exhausted: ${run.usedTokens} consumed / ${limits.maxTotalTokens} limit. This is the executor-reported aggregate, including cached tokens when the host includes them, not monetary cost (input + output fallback when no total is reported). Recorded run cache components: read ${run.usedCacheReadTokens ?? "unknown"}, write ${run.usedCacheWriteTokens ?? "unknown"}; reporting may be incomplete. Limits are checked between stages, not by interrupting an in-flight child. Review budgets.maxTotalTokens, then raise or remove that cap if appropriate and resume with /anvil resume ${run.id}.`);
    if (limits.maxTotalRequests !== undefined && run.usedRequests >= limits.maxTotalRequests) throw new AnvilError("BUDGET_EXHAUSTED", "Total request budget exhausted");
    if (limits.maxTransitions !== undefined && run.transitionCount >= limits.maxTransitions) throw new AnvilError("BUDGET_EXHAUSTED", "Workflow transition budget exhausted");
    if (limits.maxWallClockMs !== undefined && Date.now() - Date.parse(run.startedAt ?? run.createdAt) >= limits.maxWallClockMs) throw new AnvilError("BUDGET_EXHAUSTED", "Workflow wall-clock budget exhausted");
  }
  assertRoleMayRun(_run: RunRecord, role: AgentRole, attempts: number, roleTokens = 0): void { const rolePolicy = this.config.budgets.perRole[role]; if (rolePolicy?.maxAttempts !== undefined && attempts >= rolePolicy.maxAttempts) throw new AnvilError("MAX_ATTEMPTS_EXCEEDED", `${ROLE_LABELS[role]} attempt budget exhausted`); if (rolePolicy?.maxTokens !== undefined && roleTokens >= rolePolicy.maxTokens) throw new AnvilError("BUDGET_EXHAUSTED", `${ROLE_LABELS[role]} token budget exhausted: ${roleTokens} consumed / ${rolePolicy.maxTokens} limit for this role. This is the role's executor-reported aggregate, including cached tokens when the host includes them, not monetary cost (input + output fallback when no total is reported). Limits are checked between stages, not by interrupting an in-flight child. Review budgets.perRole.${role}.maxTokens, then raise or remove that cap if appropriate and resume with /anvil resume ${_run.id}.`); }
}
