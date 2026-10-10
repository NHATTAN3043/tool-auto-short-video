import { checkBudget, type ApiUsageEntry, type BudgetLimits } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { blockedReason, budgetLines, formatLimit, formFromLimits, parseBudgetForm, usageRow } from "./model";

const limits: BudgetLimits = { perCallUsd: 0.5, perDayUsd: 2, perMonthUsd: null, perProjectUsd: 1.25 };

describe("budget form", () => {
  it("round-trips limits, with a comma decimal and empty for no limit", () => {
    const form = formFromLimits(limits);
    expect(form).toEqual({ perCallUsd: "0,5", perDayUsd: "2", perMonthUsd: "", perProjectUsd: "1,25" });
    expect(parseBudgetForm(form)).toEqual({ ok: true, limits });
  });

  it("accepts a dot decimal and 0, rejects text and negatives", () => {
    expect(
      parseBudgetForm({ perCallUsd: "0.25", perDayUsd: "0", perMonthUsd: " ", perProjectUsd: "" }),
    ).toEqual({
      ok: true,
      limits: { perCallUsd: 0.25, perDayUsd: 0, perMonthUsd: null, perProjectUsd: null },
    });
    const parsed = parseBudgetForm({
      perCallUsd: "-1",
      perDayUsd: "nhiều",
      perMonthUsd: "1e3",
      perProjectUsd: "",
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(Object.keys(parsed.errors)).toEqual(["perCallUsd", "perDayUsd", "perMonthUsd"]);
  });

  it("labels a missing limit", () => {
    expect(formatLimit(null)).toBe("Không giới hạn");
    expect(formatLimit(2)).toBe("2,00 USD");
  });
});

describe("budget lines", () => {
  it("shows spend against each limit and the reason of a block", () => {
    const check = checkBudget(
      limits,
      { dayUsd: 1.95, monthUsd: 3, projectUsd: 0.2 },
      { totalUsd: 0.1, maxCallUsd: 0.1 },
    );
    expect(budgetLines(check)).toEqual([
      "24 giờ: 1,95 USD / 2,00 USD",
      "Dự án này: 0,200 USD / 1,25 USD",
      "Mỗi lần gọi tối đa: 0,500 USD",
    ]);
    expect(blockedReason(check)).toContain("Vượt ngân sách 24 giờ");
  });
});

describe("usage rows", () => {
  it("names the operation and status in Vietnamese", () => {
    const entry: ApiUsageEntry = {
      id: "use_1",
      service: "ai",
      provider: "claude",
      model: "claude-sonnet-5-5",
      operation: "scenes",
      status: "blocked",
      estimatedUsd: 0.04,
      usd: 0,
      createdAt: "2026-10-10T10:00:00.000Z",
    };
    expect(usageRow(entry)).toEqual({
      what: "AI chia cảnh · claude (claude-sonnet-5-5)",
      status: "Bị chặn",
      usd: "0,000 USD",
    });
  });
});
