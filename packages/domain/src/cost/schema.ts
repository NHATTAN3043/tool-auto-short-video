import { z } from "zod";

// Paid API calls and the budgets that cap them (M11, ADR 0009). Every call to a paid provider is logged
// as one ApiUsageEntry, including calls the budget blocked and failed calls the provider still billed.

export const PaidServiceSchema = z.enum(["ai", "tts"]);
export type PaidService = z.infer<typeof PaidServiceSchema>;

/** `ok`: the call succeeded. `failed`: it failed (maybe still billed). `blocked`: CostGuard never sent it. */
export const ApiUsageStatusSchema = z.enum(["ok", "failed", "blocked"]);
export type ApiUsageStatus = z.infer<typeof ApiUsageStatusSchema>;

export const ApiUsageEntrySchema = z.object({
  id: z.string().min(1),
  service: PaidServiceSchema,
  /** Adapter id: "claude", "elevenlabs"… */
  provider: z.string().min(1),
  model: z.string().min(1).optional(),
  /** What was asked: "script", "scenes", "visual", "speech"… */
  operation: z.string().min(1),
  projectId: z.string().min(1).optional(),
  jobId: z.string().min(1).optional(),
  status: ApiUsageStatusSchema,
  /** Worst case checked against the budgets before the call. */
  estimatedUsd: z.number().nonnegative(),
  /** What the provider billed; 0 for blocked calls. */
  usd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  characters: z.number().int().nonnegative().optional(),
  /** Why the call was blocked or failed. */
  message: z.string().max(1000).optional(),
  createdAt: z.iso.datetime(),
});
export type ApiUsageEntry = z.infer<typeof ApiUsageEntrySchema>;

/** A limit in USD; null = no limit, 0 = blocks every paid call. */
const LimitSchema = z.number().nonnegative().max(100_000).nullable();

export const BudgetLimitsSchema = z.object({
  /** Most one call may cost (its worst case). */
  perCallUsd: LimitSchema,
  /** Rolling 24 hours. */
  perDayUsd: LimitSchema,
  /** Calendar month, Vietnam time. */
  perMonthUsd: LimitSchema,
  /** All-time spend of one project; the same cap for every project. */
  perProjectUsd: LimitSchema,
});
export type BudgetLimits = z.infer<typeof BudgetLimitsSchema>;

export const BUDGET_SETTINGS_SCHEMA_VERSION = 1;

/** Budgets saved from the settings page; until then the defaults from the environment apply. */
export const BudgetSettingsSchema = z.object({
  schemaVersion: z.literal(BUDGET_SETTINGS_SCHEMA_VERSION),
  limits: BudgetLimitsSchema,
  updatedAt: z.iso.datetime(),
});
export type BudgetSettings = z.infer<typeof BudgetSettingsSchema>;

export const BudgetScopeSchema = z.enum(["call", "day", "month", "project"]);
export type BudgetScope = z.infer<typeof BudgetScopeSchema>;

/** USD already spent in each budget window. `projectUsd` is null for calls outside a project. */
export const BudgetSpendSchema = z.object({
  dayUsd: z.number().nonnegative(),
  monthUsd: z.number().nonnegative(),
  projectUsd: z.number().nonnegative().nullable(),
});
export type BudgetSpend = z.infer<typeof BudgetSpendSchema>;

/** Worst case of what is about to run: one call, or a batch of calls (TTS for several scenes). */
export const PlannedSpendSchema = z.object({
  totalUsd: z.number().nonnegative(),
  /** Most expensive single call of the batch; checked against `perCallUsd`. */
  maxCallUsd: z.number().nonnegative(),
});
export type PlannedSpend = z.infer<typeof PlannedSpendSchema>;

/** Result of checkBudget; also sent to the browser with every cost estimate. */
export const BudgetCheckSchema = z.object({
  allowed: z.boolean(),
  /** First budget the planned spend would break, in the order call, day, month, project. */
  blockedBy: BudgetScopeSchema.nullable(),
  limits: BudgetLimitsSchema,
  spent: BudgetSpendSchema,
  planned: PlannedSpendSchema,
});
export type BudgetCheck = z.infer<typeof BudgetCheckSchema>;
