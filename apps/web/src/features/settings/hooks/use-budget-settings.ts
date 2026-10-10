"use client";

import { useState } from "react";

import {
  fetchBudgetSettings,
  fetchUsageReport,
  saveBudgetSettings,
  type BudgetSettingsView,
  type UsageReport,
} from "../api";
import { formFromLimits, parseBudgetForm, type BudgetForm, type BudgetKey } from "../model";

export type BudgetSaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Keeps the form draft of the budgets and saves it. The page loads the first view and report on the
 * server; `reload` fetches them again (after paid calls made in another tab).
 */
export function useBudgetSettings(initial: { view: BudgetSettingsView; report: UsageReport }) {
  const [view, setView] = useState(initial.view);
  const [report, setReport] = useState(initial.report);
  const [form, setForm] = useState<BudgetForm>(() => formFromLimits(initial.view.limits));
  const [status, setStatus] = useState<BudgetSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const parsed = parseBudgetForm(form);
  const dirty = parsed.ok && JSON.stringify(parsed.limits) !== JSON.stringify(view.limits);

  async function reload() {
    setError(null);
    try {
      const [settings, usage] = await Promise.all([fetchBudgetSettings(), fetchUsageReport()]);
      setView(settings);
      setReport(usage);
      if (!dirty) setForm(formFromLimits(settings.limits));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được cài đặt ngân sách.");
    }
  }

  async function save() {
    if (!parsed.ok || !dirty) return;
    setStatus("saving");
    setError(null);
    try {
      const saved = await saveBudgetSettings(parsed.limits);
      setView(saved);
      setForm(formFromLimits(saved.limits));
      setStatus("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được.");
      setStatus("error");
    }
  }

  return {
    view,
    report,
    form,
    errors: parsed.ok ? {} : parsed.errors,
    dirty,
    status,
    error,
    setField: (key: BudgetKey, value: string) => {
      setForm((current) => ({ ...current, [key]: value }));
      setStatus("idle");
    },
    resetToDefaults: () => {
      setForm(formFromLimits(view.defaults));
    },
    save,
    reload,
  };
}

export type BudgetSettingsState = ReturnType<typeof useBudgetSettings>;
