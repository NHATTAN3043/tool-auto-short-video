import { describe, expect, it } from "vitest";

import {
  budgetExceededMessage,
  budgetMonthStart,
  budgetWindows,
  checkBudget,
  effectiveBudgetLimits,
  formatUsd,
  sumUsageUsd,
  summarizeUsage,
} from "./budget";
import { ApiUsageEntrySchema, BudgetSettingsSchema, type ApiUsageEntry, type BudgetLimits } from "./schema";

const NO_LIMITS: BudgetLimits = { perCallUsd: null, perDayUsd: null, perMonthUsd: null, perProjectUsd: null };

const entry = (extra: Partial<ApiUsageEntry>): ApiUsageEntry => ({
  id: "use_1",
  service: "ai",
  provider: "claude",
  operation: "script",
  projectId: "prj_1",
  status: "ok",
  estimatedUsd: 0.05,
  usd: 0.01,
  createdAt: "2026-10-10T10:00:00.000Z",
  ...extra,
});

describe("budget windows", () => {
  it("starts the month at midnight Vietnam time", () => {
    expect(budgetMonthStart("2026-10-10T12:00:00.000Z")).toBe("2026-09-30T17:00:00.000Z");
    // 2026-10-31T18:00Z is already 1 November in Vietnam.
    expect(budgetMonthStart("2026-10-31T18:00:00.000Z")).toBe("2026-10-31T17:00:00.000Z");
    expect(budgetMonthStart("2027-01-01T00:00:00.000Z")).toBe("2026-12-31T17:00:00.000Z");
  });

  it("uses a rolling 24 hours for the day", () => {
    expect(budgetWindows("2026-10-10T12:00:00.000Z").daySince).toBe("2026-10-09T12:00:00.000Z");
  });

  it("sums billed USD per window and project", () => {
    const entries = [
      entry({ usd: 0.01 }),
      entry({ usd: 0.02, projectId: "prj_2" }),
      entry({ usd: 0, status: "blocked" }),
      entry({ usd: 1, createdAt: "2026-10-09T11:59:59.000Z" }),
    ];
    expect(sumUsageUsd(entries)).toBeCloseTo(1.03, 9);
    expect(sumUsageUsd(entries, { since: "2026-10-09T12:00:00.000Z" })).toBeCloseTo(0.03, 9);
    expect(sumUsageUsd(entries, { projectId: "prj_1" })).toBeCloseTo(1.01, 9);
  });
});

describe("checkBudget", () => {
  const spent = { dayUsd: 0.4, monthUsd: 5, projectUsd: 0.9 };
  const planned = { totalUsd: 0.1, maxCallUsd: 0.05 };

  it("allows everything without limits", () => {
    expect(checkBudget(NO_LIMITS, spent, planned)).toMatchObject({ allowed: true, blockedBy: null });
  });

  it("reports the first broken budget in the order call, day, month, project", () => {
    const limits: BudgetLimits = { perCallUsd: 0.01, perDayUsd: 0.45, perMonthUsd: 5, perProjectUsd: 0.95 };
    expect(checkBudget(limits, spent, planned).blockedBy).toBe("call");
    expect(checkBudget({ ...limits, perCallUsd: null }, spent, planned).blockedBy).toBe("day");
    expect(checkBudget({ ...limits, perCallUsd: null, perDayUsd: null }, spent, planned).blockedBy).toBe(
      "month",
    );
    expect(checkBudget({ ...NO_LIMITS, perProjectUsd: 0.95 }, spent, planned)).toMatchObject({
      allowed: false,
      blockedBy: "project",
    });
  });

  it("allows spend that lands exactly on a limit, despite float noise", () => {
    const check = checkBudget(
      { ...NO_LIMITS, perDayUsd: 0.3 },
      { dayUsd: 0.1 + 0.1, monthUsd: 0, projectUsd: 0 },
      { totalUsd: 0.1, maxCallUsd: 0.1 },
    );
    expect(check.allowed).toBe(true);
  });

  it("blocks every paid call with a limit of 0", () => {
    const check = checkBudget(
      { ...NO_LIMITS, perDayUsd: 0 },
      { dayUsd: 0, monthUsd: 0, projectUsd: null },
      { totalUsd: 0.001, maxCallUsd: 0.001 },
    );
    expect(check.blockedBy).toBe("day");
  });

  it("skips the project budget for calls outside a project", () => {
    const check = checkBudget(
      { ...NO_LIMITS, perProjectUsd: 0 },
      { dayUsd: 0, monthUsd: 0, projectUsd: null },
      planned,
    );
    expect(check.allowed).toBe(true);
  });

  it("explains the block in Vietnamese", () => {
    const day = checkBudget({ ...NO_LIMITS, perDayUsd: 0.45 }, spent, planned);
    expect(budgetExceededMessage(day)).toBe(
      "Vượt ngân sách 24 giờ: đã dùng 0,400 USD / 0,450 USD, lượt này cần tối đa 0,100 USD. Đổi giới hạn trong trang Cài đặt ngân sách nếu cần.",
    );
    const call = checkBudget({ ...NO_LIMITS, perCallUsd: 0.01 }, spent, planned);
    expect(budgetExceededMessage(call)).toContain("mỗi lần gọi (0,010 USD)");
    expect(budgetExceededMessage(checkBudget(NO_LIMITS, spent, planned))).toBeNull();
  });
});

describe("budget settings and usage", () => {
  it("falls back to the defaults until settings are saved", () => {
    const defaults = { ...NO_LIMITS, perDayUsd: 2 };
    expect(effectiveBudgetLimits(null, defaults)).toEqual(defaults);
    const saved = BudgetSettingsSchema.parse({
      schemaVersion: 1,
      limits: { ...NO_LIMITS, perMonthUsd: 10 },
      updatedAt: "2026-10-10T00:00:00.000Z",
    });
    expect(effectiveBudgetLimits(saved, defaults)).toEqual({ ...NO_LIMITS, perMonthUsd: 10 });
  });

  it("rejects negative limits and malformed entries", () => {
    expect(
      BudgetSettingsSchema.safeParse({
        schemaVersion: 1,
        limits: { ...NO_LIMITS, perDayUsd: -1 },
        updatedAt: "2026-10-10T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(ApiUsageEntrySchema.safeParse({ ...entry({}), usd: -0.1 }).success).toBe(false);
  });

  it("summarizes spend per window and per project, most expensive first", () => {
    const summary = summarizeUsage(
      [
        entry({ usd: 0.01 }),
        entry({ usd: 0.5, projectId: "prj_2", createdAt: "2026-09-15T00:00:00.000Z" }),
        entry({ usd: 0, status: "blocked" }),
        entry({ usd: 0.02, projectId: undefined }),
      ],
      "2026-10-10T12:00:00.000Z",
    );
    expect(summary).toMatchObject({ monthStart: "2026-09-30T17:00:00.000Z" });
    expect(summary.dayUsd).toBeCloseTo(0.03, 9);
    expect(summary.monthUsd).toBeCloseTo(0.03, 9);
    expect(summary.totalUsd).toBeCloseTo(0.53, 9);
    expect(summary.byProject.map((row) => [row.projectId, row.calls, row.blockedCalls])).toEqual([
      ["prj_2", 1, 0],
      [null, 1, 0],
      ["prj_1", 1, 1],
    ]);
    expect(summary.byProject[0]?.monthUsd).toBe(0);
  });

  it("formats USD like the rest of the UI", () => {
    expect(formatUsd(0.0004)).toBe("< 0,001 USD");
    expect(formatUsd(0.042)).toBe("0,042 USD");
    expect(formatUsd(12.5)).toBe("12,50 USD");
  });
});
