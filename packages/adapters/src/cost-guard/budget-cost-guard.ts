import {
  budgetExceededMessage,
  budgetWindows,
  checkBudget,
  DomainError,
  effectiveBudgetLimits,
  newId,
  type ApiUsageEntry,
  type BudgetCheck,
  type BudgetLimits,
  type IdGenerator,
  type PlannedSpend,
} from "@studio/domain";
import {
  KeyedLock,
  type ApiUsageLog,
  type BudgetSettingsStore,
  type Clock,
  type CostGuardPort,
  type GuardedRun,
  type PaidCallOutcome,
} from "@studio/services";

export interface BudgetCostGuardOptions {
  log: ApiUsageLog;
  settings: BudgetSettingsStore;
  /** From the environment; apply until the settings page is saved once. */
  defaults: BudgetLimits;
  clock: Clock;
  newId?: IdGenerator;
}

const MAX_MESSAGE_LENGTH = 1000;
// One lock for every budget: check, call and log run one at a time, so two calls never both pass.
const GLOBAL = "budget";

/**
 * CostGuard over the `api_usage` log (ADR 0009). Budgets are read on every check, so a change on the
 * settings page applies to the next call without a restart.
 */
export class BudgetCostGuard implements CostGuardPort {
  private readonly lock = new KeyedLock();

  constructor(private readonly options: BudgetCostGuardOptions) {}

  check(planned: PlannedSpend & { projectId?: string }): Promise<BudgetCheck> {
    return this.checkUnlocked(planned);
  }

  guard<T>({ call, run, onResult, onError }: GuardedRun<T>): Promise<T> {
    return this.lock.run(GLOBAL, async () => {
      const base: Omit<ApiUsageEntry, "status" | "usd"> = {
        id: (this.options.newId ?? newId)("use"),
        service: call.service,
        provider: call.provider,
        operation: call.operation,
        estimatedUsd: call.maxUsd,
        createdAt: this.options.clock.now(),
        ...(call.model !== undefined && { model: call.model }),
        ...(call.projectId !== undefined && { projectId: call.projectId }),
        ...(call.jobId !== undefined && { jobId: call.jobId }),
      };
      const check = await this.checkUnlocked({
        ...(call.projectId !== undefined && { projectId: call.projectId }),
        totalUsd: call.maxUsd,
        maxCallUsd: call.maxUsd,
      });
      const blocked = budgetExceededMessage(check);
      if (blocked !== null) {
        await this.options.log.append({ ...base, status: "blocked", usd: 0, message: blocked });
        throw new DomainError("BUDGET_EXCEEDED", blocked);
      }

      let result: T;
      try {
        result = await run();
      } catch (error) {
        await this.options.log.append({ ...base, ...this.clean(onError(error)) });
        throw error;
      }
      await this.options.log.append({ ...base, ...this.clean(onResult(result)) });
      return result;
    });
  }

  private async checkUnlocked(planned: PlannedSpend & { projectId?: string }): Promise<BudgetCheck> {
    const { log, settings, defaults, clock } = this.options;
    const { daySince, monthSince } = budgetWindows(clock.now());
    const [saved, dayUsd, monthUsd, projectUsd] = await Promise.all([
      settings.get(),
      log.totalUsd({ since: daySince }),
      log.totalUsd({ since: monthSince }),
      planned.projectId === undefined
        ? Promise.resolve(null)
        : log.totalUsd({ projectId: planned.projectId }),
    ]);
    return checkBudget(
      effectiveBudgetLimits(saved, defaults),
      { dayUsd, monthUsd, projectUsd },
      { totalUsd: planned.totalUsd, maxCallUsd: planned.maxCallUsd },
    );
  }

  private clean(outcome: PaidCallOutcome): PaidCallOutcome {
    if (outcome.message === undefined || outcome.message.length <= MAX_MESSAGE_LENGTH) return outcome;
    return { ...outcome, message: `${outcome.message.slice(0, MAX_MESSAGE_LENGTH - 1)}…` };
  }
}
