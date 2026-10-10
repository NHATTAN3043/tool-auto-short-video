import type {
  ApiUsageEntry,
  BudgetCheck,
  BudgetSettings,
  PaidService,
  PlannedSpend,
  UsageFilter,
} from "@studio/domain";

/** Append-only log of every paid call (`api_usage`). */
export interface ApiUsageLog {
  append(entry: ApiUsageEntry): Promise<void>;
  /** Billed USD of the matching entries. */
  totalUsd(filter?: UsageFilter): Promise<number>;
  /** Oldest first. */
  list(filter?: UsageFilter): Promise<ApiUsageEntry[]>;
}

/** The budgets saved from the settings page. */
export interface BudgetSettingsStore {
  /** Null until saved once; the environment defaults apply meanwhile. */
  get(): Promise<BudgetSettings | null>;
  save(settings: BudgetSettings): Promise<BudgetSettings>;
}

/** Who a paid call is made for, so it is logged and counted against that project's budget. */
export interface PaidCallContext {
  projectId: string;
  jobId?: string;
}

/** One paid call about to be sent. */
export interface PaidCall extends Partial<PaidCallContext> {
  service: PaidService;
  provider: string;
  model?: string;
  operation: string;
  /** Worst case of the call; checked against every budget. */
  maxUsd: number;
}

/** What a finished call cost, to log. */
export interface PaidCallOutcome {
  status: "ok" | "failed";
  usd: number;
  inputTokens?: number;
  outputTokens?: number;
  characters?: number;
  message?: string;
}

export interface GuardedRun<T> {
  call: PaidCall;
  run: () => Promise<T>;
  /** Cost of a successful call. */
  onResult: (result: T) => PaidCallOutcome;
  /** Cost of a failed call: some providers still bill refusals and truncated answers. */
  onError: (error: unknown) => PaidCallOutcome;
}

/**
 * Budgets for every paid call (rule 7). `guard` is the only way a paid adapter is called: it checks the
 * budgets, runs the call and logs it; a blocked call is logged too and throws DomainError BUDGET_EXCEEDED.
 */
export interface CostGuardPort {
  /** Free: whether the planned spend fits, without running or logging anything. */
  check(planned: PlannedSpend & { projectId?: string }): Promise<BudgetCheck>;
  guard<T>(request: GuardedRun<T>): Promise<T>;
}

/** Builds a paid port bound to one project (and job), wrapped by CostGuard in the composition root. */
export type PaidPortFactory<T> = (context: PaidCallContext) => T;
