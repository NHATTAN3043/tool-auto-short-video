import {
  budgetExceededMessage,
  formatUsd,
  type ApiUsageEntry,
  type BudgetCheck,
  type BudgetLimits,
} from "@studio/domain";

// Pure rules of the budget settings page and of the budget lines shown before every paid call.

export type BudgetKey = keyof BudgetLimits;

export const BUDGET_FIELDS: readonly { key: BudgetKey; label: string; hint: string }[] = [
  {
    key: "perCallUsd",
    label: "Mỗi lần gọi",
    hint: "Chi phí tối đa của một lần gọi AI hoặc tạo giọng một cảnh.",
  },
  { key: "perDayUsd", label: "24 giờ", hint: "Tổng chi trong 24 giờ gần nhất." },
  { key: "perMonthUsd", label: "Tháng", hint: "Tổng chi từ ngày 1 của tháng, theo giờ Việt Nam." },
  {
    key: "perProjectUsd",
    label: "Mỗi dự án",
    hint: "Tổng chi của một dự án từ trước tới nay; áp cho mọi dự án.",
  },
];

/** Text of each input; an empty field means no limit. */
export type BudgetForm = Record<BudgetKey, string>;

export function formFromLimits(limits: BudgetLimits): BudgetForm {
  const text = (value: number | null) => (value === null ? "" : String(value).replace(".", ","));
  return {
    perCallUsd: text(limits.perCallUsd),
    perDayUsd: text(limits.perDayUsd),
    perMonthUsd: text(limits.perMonthUsd),
    perProjectUsd: text(limits.perProjectUsd),
  };
}

export type ParsedBudgetForm =
  { ok: true; limits: BudgetLimits } | { ok: false; errors: Partial<Record<BudgetKey, string>> };

/** Accepts `1,5` and `1.5`; empty = no limit; 0 blocks every paid call. */
export function parseBudgetForm(form: BudgetForm): ParsedBudgetForm {
  const limits: Partial<BudgetLimits> = {};
  const errors: Partial<Record<BudgetKey, string>> = {};
  for (const { key } of BUDGET_FIELDS) {
    const text = form[key].trim().replace(",", ".");
    if (text === "") {
      limits[key] = null;
      continue;
    }
    const value = Number(text);
    if (!/^\d+(\.\d+)?$/u.test(text) || !Number.isFinite(value)) {
      errors[key] = "Nhập số USD không âm, ví dụ 0,5. Để trống nếu không giới hạn.";
    } else if (value > 100_000) {
      errors[key] = "Giới hạn quá lớn.";
    } else {
      limits[key] = value;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    limits: {
      perCallUsd: limits.perCallUsd ?? null,
      perDayUsd: limits.perDayUsd ?? null,
      perMonthUsd: limits.perMonthUsd ?? null,
      perProjectUsd: limits.perProjectUsd ?? null,
    },
  };
}

export function formatLimit(limit: number | null): string {
  return limit === null ? "Không giới hạn" : formatUsd(limit);
}

/** `24 giờ: 0,120 USD / 2,00 USD`, one line per budget that has a limit (the per-call one is shown once). */
export function budgetLines(check: BudgetCheck): string[] {
  const { limits, spent } = check;
  const lines: string[] = [];
  if (limits.perDayUsd !== null)
    lines.push(`24 giờ: ${formatUsd(spent.dayUsd)} / ${formatUsd(limits.perDayUsd)}`);
  if (limits.perMonthUsd !== null) {
    lines.push(`Tháng này: ${formatUsd(spent.monthUsd)} / ${formatUsd(limits.perMonthUsd)}`);
  }
  if (limits.perProjectUsd !== null && spent.projectUsd !== null) {
    lines.push(`Dự án này: ${formatUsd(spent.projectUsd)} / ${formatUsd(limits.perProjectUsd)}`);
  }
  if (limits.perCallUsd !== null) lines.push(`Mỗi lần gọi tối đa: ${formatUsd(limits.perCallUsd)}`);
  return lines;
}

/** Why the paid call would be blocked, or null when it fits every budget. */
export function blockedReason(check: BudgetCheck): string | null {
  return budgetExceededMessage(check);
}

const STATUS_LABELS: Record<ApiUsageEntry["status"], string> = {
  ok: "Thành công",
  failed: "Lỗi",
  blocked: "Bị chặn",
};

const OPERATION_LABELS: Record<string, string> = {
  script: "AI viết script",
  scenes: "AI chia cảnh",
  visual: "AI gợi ý hình",
  speech: "Tạo giọng",
};

/** One row of the recent calls table. */
export function usageRow(entry: ApiUsageEntry): { what: string; status: string; usd: string } {
  return {
    what: `${OPERATION_LABELS[entry.operation] ?? entry.operation} · ${entry.provider}${entry.model ? ` (${entry.model})` : ""}`,
    status: STATUS_LABELS[entry.status],
    usd: formatUsd(entry.usd),
  };
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(iso));
}
