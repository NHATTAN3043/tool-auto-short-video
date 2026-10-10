import { ApiUsageEntrySchema, BudgetLimitsSchema, type BudgetLimits } from "@studio/domain";
import { z } from "zod";

import { request } from "@/features/project/api";

export const BudgetSettingsViewSchema = z.object({
  limits: BudgetLimitsSchema,
  defaults: BudgetLimitsSchema,
  updatedAt: z.string().nullable(),
});
export type BudgetSettingsView = z.infer<typeof BudgetSettingsViewSchema>;

export const UsageReportSchema = z.object({
  dayUsd: z.number(),
  monthUsd: z.number(),
  monthStart: z.string(),
  totalUsd: z.number(),
  byProject: z.array(
    z.object({
      projectId: z.string().nullable(),
      projectName: z.string().nullable(),
      totalUsd: z.number(),
      monthUsd: z.number(),
      calls: z.number(),
      blockedCalls: z.number(),
    }),
  ),
  recent: z.array(ApiUsageEntrySchema),
});
export type UsageReport = z.infer<typeof UsageReportSchema>;

export function fetchBudgetSettings(): Promise<BudgetSettingsView> {
  return request("/api/settings/budget", { method: "GET" }, BudgetSettingsViewSchema);
}

export function saveBudgetSettings(limits: BudgetLimits): Promise<BudgetSettingsView> {
  return request(
    "/api/settings/budget",
    { method: "PUT", body: JSON.stringify({ limits }) },
    BudgetSettingsViewSchema,
  );
}

export function fetchUsageReport(): Promise<UsageReport> {
  return request("/api/usage", { method: "GET" }, UsageReportSchema);
}
