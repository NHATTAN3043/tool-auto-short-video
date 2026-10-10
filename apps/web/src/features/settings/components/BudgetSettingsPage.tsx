"use client";

import type { BudgetSettingsView, UsageReport } from "../api";
import { useBudgetSettings } from "../hooks/use-budget-settings";
import { BudgetSettingsForm } from "./BudgetSettingsForm";
import { UsageReportView } from "./UsageReportView";

export function BudgetSettingsPage(initial: { view: BudgetSettingsView; report: UsageReport }) {
  const state = useBudgetSettings(initial);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Cài đặt ngân sách</h1>
      <BudgetSettingsForm state={state} />
      <UsageReportView
        report={state.report}
        onReload={() => {
          void state.reload();
        }}
      />
    </div>
  );
}
