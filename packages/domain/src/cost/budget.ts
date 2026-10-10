import type {
  ApiUsageEntry,
  BudgetCheck,
  BudgetLimits,
  BudgetScope,
  BudgetSettings,
  BudgetSpend,
  PlannedSpend,
} from "./schema";

/** The daily budget is a rolling window, so it needs no time zone (same rule as ADR 0007). */
export const BUDGET_DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The monthly budget follows the calendar in Vietnam time, UTC+7 all year (no daylight saving). */
export const BUDGET_UTC_OFFSET_MINUTES = 7 * 60;
/** Absorbs float noise when sums of small USD amounts are compared with a limit. */
const EPSILON_USD = 1e-9;

export interface UsageFilter {
  /** Entries created at or after this instant. */
  since?: string;
  projectId?: string;
}

/** Start of the calendar month containing `nowIso`, in a fixed UTC offset, as an ISO instant. */
export function budgetMonthStart(nowIso: string, offsetMinutes = BUDGET_UTC_OFFSET_MINUTES): string {
  const offsetMs = offsetMinutes * 60_000;
  const local = new Date(Date.parse(nowIso) + offsetMs);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return new Date(startLocal - offsetMs).toISOString();
}

export function budgetWindows(nowIso: string): { daySince: string; monthSince: string } {
  return {
    daySince: new Date(Date.parse(nowIso) - BUDGET_DAY_WINDOW_MS).toISOString(),
    monthSince: budgetMonthStart(nowIso),
  };
}

export function matchesUsageFilter(entry: ApiUsageEntry, filter: UsageFilter): boolean {
  if (filter.projectId !== undefined && entry.projectId !== filter.projectId) return false;
  return filter.since === undefined || Date.parse(entry.createdAt) >= Date.parse(filter.since);
}

/** What the providers billed for the matching entries. Blocked calls cost nothing. */
export function sumUsageUsd(entries: readonly ApiUsageEntry[], filter: UsageFilter = {}): number {
  let total = 0;
  for (const entry of entries) if (matchesUsageFilter(entry, filter)) total += entry.usd;
  return total;
}

/** Saved budgets, or the environment defaults until the settings page has been saved once. */
export function effectiveBudgetLimits(settings: BudgetSettings | null, defaults: BudgetLimits): BudgetLimits {
  return settings?.limits ?? defaults;
}

function fits(spent: number, planned: number, limit: number | null): boolean {
  return limit === null || spent + planned <= limit + EPSILON_USD;
}

/** Whether the worst case of the planned spend stays within every budget. Pure; makes no call. */
export function checkBudget(limits: BudgetLimits, spent: BudgetSpend, planned: PlannedSpend): BudgetCheck {
  let blockedBy: BudgetScope | null = null;
  if (!fits(0, planned.maxCallUsd, limits.perCallUsd)) blockedBy = "call";
  else if (!fits(spent.dayUsd, planned.totalUsd, limits.perDayUsd)) blockedBy = "day";
  else if (!fits(spent.monthUsd, planned.totalUsd, limits.perMonthUsd)) blockedBy = "month";
  else if (spent.projectUsd !== null && !fits(spent.projectUsd, planned.totalUsd, limits.perProjectUsd)) {
    blockedBy = "project";
  }
  return { allowed: blockedBy === null, blockedBy, limits, spent, planned };
}

/** `0,012 USD`; amounts under a tenth of a cent show as `< 0,001 USD`. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.001) return "< 0,001 USD";
  return `${usd.toFixed(usd < 1 ? 3 : 2).replace(".", ",")} USD`;
}

const SCOPE_LABELS: Record<BudgetScope, string> = {
  call: "mỗi lần gọi",
  day: "24 giờ",
  month: "tháng này",
  project: "mỗi dự án",
};

/** Vietnamese, shown as is in the UI and stored on failed jobs. Null when the check passed. */
export function budgetExceededMessage(check: BudgetCheck): string | null {
  const scope = check.blockedBy;
  if (scope === null) return null;
  const advice = "Đổi giới hạn trong trang Cài đặt ngân sách nếu cần.";
  if (scope === "call") {
    const limit = check.limits.perCallUsd ?? 0;
    return `Lượt này có thể tốn tới ${formatUsd(check.planned.maxCallUsd)}, vượt giới hạn ${SCOPE_LABELS.call} (${formatUsd(limit)}). ${advice}`;
  }
  const limit =
    (scope === "day"
      ? check.limits.perDayUsd
      : scope === "month"
        ? check.limits.perMonthUsd
        : check.limits.perProjectUsd) ?? 0;
  const spent =
    scope === "day"
      ? check.spent.dayUsd
      : scope === "month"
        ? check.spent.monthUsd
        : (check.spent.projectUsd ?? 0);
  return `Vượt ngân sách ${SCOPE_LABELS[scope]}: đã dùng ${formatUsd(spent)} / ${formatUsd(limit)}, lượt này cần tối đa ${formatUsd(check.planned.totalUsd)}. ${advice}`;
}

export interface ProjectUsage {
  /** Null for calls made outside a project. */
  projectId: string | null;
  totalUsd: number;
  monthUsd: number;
  calls: number;
  blockedCalls: number;
}

export interface UsageSummary {
  dayUsd: number;
  monthUsd: number;
  monthStart: string;
  totalUsd: number;
  /** Most expensive project first. */
  byProject: ProjectUsage[];
}

export function summarizeUsage(entries: readonly ApiUsageEntry[], nowIso: string): UsageSummary {
  const { daySince, monthSince } = budgetWindows(nowIso);
  const byProject = new Map<string | null, ProjectUsage>();
  for (const entry of entries) {
    const key = entry.projectId ?? null;
    const row = byProject.get(key) ?? { projectId: key, totalUsd: 0, monthUsd: 0, calls: 0, blockedCalls: 0 };
    row.totalUsd += entry.usd;
    if (matchesUsageFilter(entry, { since: monthSince })) row.monthUsd += entry.usd;
    if (entry.status === "blocked") row.blockedCalls += 1;
    else row.calls += 1;
    byProject.set(key, row);
  }
  return {
    dayUsd: sumUsageUsd(entries, { since: daySince }),
    monthUsd: sumUsageUsd(entries, { since: monthSince }),
    monthStart: monthSince,
    totalUsd: sumUsageUsd(entries),
    byProject: [...byProject.values()].sort((a, b) => b.totalUsd - a.totalUsd),
  };
}
