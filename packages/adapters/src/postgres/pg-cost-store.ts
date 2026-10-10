import { and, asc, eq, gte, sql, type SQL } from "drizzle-orm";

import {
  ApiUsageEntrySchema,
  BudgetSettingsSchema,
  type ApiUsageEntry,
  type BudgetSettings,
  type UsageFilter,
} from "@studio/domain";
import type { ApiUsageLog, BudgetSettingsStore } from "@studio/services";

import type { PgDb } from "./database";
import { apiUsage, budgetSettings } from "./schema";

type UsageRow = typeof apiUsage.$inferSelect;

function where(filter: UsageFilter): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.since !== undefined) conditions.push(gte(apiUsage.createdAt, new Date(filter.since)));
  if (filter.projectId !== undefined) conditions.push(eq(apiUsage.projectId, filter.projectId));
  return conditions.length === 0 ? undefined : and(...conditions);
}

/** Null columns become missing keys, exactly like an entry read from the JSON log. */
function fromRow(row: UsageRow): ApiUsageEntry {
  return ApiUsageEntrySchema.parse({
    id: row.id,
    service: row.service,
    provider: row.provider,
    operation: row.operation,
    status: row.status,
    estimatedUsd: row.estimatedUsd,
    usd: row.usd,
    createdAt: row.createdAt.toISOString(),
    ...(row.model !== null && { model: row.model }),
    ...(row.projectId !== null && { projectId: row.projectId }),
    ...(row.jobId !== null && { jobId: row.jobId }),
    ...(row.inputTokens !== null && { inputTokens: row.inputTokens }),
    ...(row.outputTokens !== null && { outputTokens: row.outputTokens }),
    ...(row.characters !== null && { characters: row.characters }),
    ...(row.message !== null && { message: row.message }),
  });
}

/** The `api_usage` table: one row per paid call. */
export class PgApiUsageLog implements ApiUsageLog {
  constructor(private readonly db: PgDb) {}

  async append(entry: ApiUsageEntry): Promise<void> {
    const parsed = ApiUsageEntrySchema.parse(entry);
    await this.db.insert(apiUsage).values({
      id: parsed.id,
      service: parsed.service,
      provider: parsed.provider,
      model: parsed.model ?? null,
      operation: parsed.operation,
      projectId: parsed.projectId ?? null,
      jobId: parsed.jobId ?? null,
      status: parsed.status,
      estimatedUsd: parsed.estimatedUsd,
      usd: parsed.usd,
      inputTokens: parsed.inputTokens ?? null,
      outputTokens: parsed.outputTokens ?? null,
      characters: parsed.characters ?? null,
      message: parsed.message ?? null,
      createdAt: new Date(parsed.createdAt),
    });
  }

  async totalUsd(filter: UsageFilter = {}): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`coalesce(sum(${apiUsage.usd}), 0)::double precision` })
      .from(apiUsage)
      .where(where(filter));
    return row?.total ?? 0;
  }

  async list(filter: UsageFilter = {}): Promise<ApiUsageEntry[]> {
    const rows = await this.db
      .select()
      .from(apiUsage)
      .where(where(filter))
      .orderBy(asc(apiUsage.createdAt), asc(apiUsage.id));
    return rows.map(fromRow);
  }
}

const SETTINGS_ID = "default";

/** The `budget_settings` table: one row. */
export class PgBudgetSettings implements BudgetSettingsStore {
  constructor(private readonly db: PgDb) {}

  async get(): Promise<BudgetSettings | null> {
    const [row] = await this.db.select().from(budgetSettings).where(eq(budgetSettings.id, SETTINGS_ID));
    return row ? BudgetSettingsSchema.parse(row.data) : null;
  }

  async save(settings: BudgetSettings): Promise<BudgetSettings> {
    const parsed = BudgetSettingsSchema.parse(settings);
    const values = { data: parsed, updatedAt: new Date(parsed.updatedAt) };
    await this.db
      .insert(budgetSettings)
      .values({ id: SETTINGS_ID, ...values })
      .onConflictDoUpdate({ target: budgetSettings.id, set: values });
    return parsed;
  }
}
