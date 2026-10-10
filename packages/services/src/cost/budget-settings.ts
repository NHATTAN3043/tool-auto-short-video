import {
  BUDGET_SETTINGS_SCHEMA_VERSION,
  BudgetLimitsSchema,
  DomainError,
  effectiveBudgetLimits,
  summarizeUsage,
  type ApiUsageEntry,
  type BudgetLimits,
  type BudgetSettings,
  type ProjectUsage,
  type UsageSummary,
} from "@studio/domain";

import type { Clock } from "../ports/clock";
import type { ApiUsageLog, BudgetSettingsStore } from "../ports/cost-guard";
import type { ProjectRepository } from "../ports/project-repository";

export interface BudgetSettingsView {
  /** The budgets in force. */
  limits: BudgetLimits;
  /** From the environment; in force until the settings page is saved once. */
  defaults: BudgetLimits;
  /** Null until saved. */
  updatedAt: string | null;
}

export function makeGetBudgetSettings(deps: { store: BudgetSettingsStore; defaults: BudgetLimits }) {
  return async (): Promise<BudgetSettingsView> => {
    const saved = await deps.store.get();
    return {
      limits: effectiveBudgetLimits(saved, deps.defaults),
      defaults: deps.defaults,
      updatedAt: saved?.updatedAt ?? null,
    };
  };
}

export function makeSaveBudgetSettings(deps: { store: BudgetSettingsStore; clock: Clock }) {
  return (limits: BudgetLimits): Promise<BudgetSettings> => {
    const parsed = BudgetLimitsSchema.safeParse(limits);
    if (!parsed.success) return Promise.reject(new DomainError("INVALID_INPUT", "Invalid budget limits"));
    return deps.store.save({
      schemaVersion: BUDGET_SETTINGS_SCHEMA_VERSION,
      limits: parsed.data,
      updatedAt: deps.clock.now(),
    });
  };
}

export const RECENT_USAGE_ENTRIES = 50;

export interface UsageReport extends Omit<UsageSummary, "byProject"> {
  /** Project name is null for calls outside a project and for deleted projects. */
  byProject: (ProjectUsage & { projectName: string | null })[];
  /** Newest first. */
  recent: ApiUsageEntry[];
}

/** Spend per budget window and per project, for the settings page. */
export function makeGetUsageReport(deps: { log: ApiUsageLog; repo: ProjectRepository; clock: Clock }) {
  return async (): Promise<UsageReport> => {
    const [entries, projects] = await Promise.all([deps.log.list(), deps.repo.list()]);
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const summary = summarizeUsage(entries, deps.clock.now());
    return {
      ...summary,
      byProject: summary.byProject.map((row) => ({
        ...row,
        projectName: row.projectId === null ? null : (names.get(row.projectId) ?? null),
      })),
      recent: entries.slice(-RECENT_USAGE_ENTRIES).reverse(),
    };
  };
}
