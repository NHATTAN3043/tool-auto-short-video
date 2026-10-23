import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Tables of ADR 0005. A project is stored whole as JSONB (it is always read and written as one aggregate);
// the summary columns are copied out of `data` on every write so listing never reads the document.
// After changing this file run `pnpm db:generate` and commit the new migration.

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    mode: text("mode").notNull(),
    sceneCount: integer("scene_count").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    data: jsonb("data").$type<unknown>().notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [index("projects_updated_at_idx").on(table.updatedAt.desc())],
);

export const renderJobs = pgTable(
  "render_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind"),
    /** Scenes of a `tts` job. */
    sceneIds: jsonb("scene_ids").$type<string[]>(),
    /** Task, reservation and cost of an `ai` job; validated by RenderJobSchema on read. */
    ai: jsonb("ai").$type<unknown>(),
    /** Request, steps and cost of a `full_ai` job; validated by RenderJobSchema on read. */
    fullAi: jsonb("full_ai").$type<unknown>(),
    /** Options of a `tts` job (regenerate, loudness only); validated by RenderJobSchema on read. */
    voice: jsonb("voice").$type<unknown>(),
    /** Videos and cost of a `clip` job (ADR 0019); validated by RenderJobSchema on read. */
    clip: jsonb("clip").$type<unknown>(),
    status: text("status").notNull(),
    progress: doublePrecision("progress").notNull(),
    outputPath: text("output_path"),
    srtPath: text("srt_path"),
    errorMessage: text("error_message"),
    createdAt: timestamptz("created_at").notNull(),
    startedAt: timestamptz("started_at"),
    completedAt: timestamptz("completed_at"),
  },
  (table) => [
    index("render_jobs_status_created_at_idx").on(table.status, table.createdAt),
    index("render_jobs_project_id_idx").on(table.projectId),
    check(
      "render_jobs_status_check",
      sql`${table.status} in ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    ),
  ],
);

export const sfxLibrary = pgTable("sfx_library", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  fileName: text("file_name").notNull(),
  path: text("path").notNull(),
  durationMs: integer("duration_ms"),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});

/** Shared stock media library (M10). The item is stored whole; `source_ref` keeps one row per stock file. */
export const mediaLibrary = pgTable(
  "media_library",
  {
    id: text("id").primaryKey(),
    sourceRef: text("source_ref").notNull(),
    data: jsonb("data").$type<unknown>().notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [uniqueIndex("media_library_source_ref_idx").on(table.sourceRef)],
);

/**
 * Every paid API call (M11, ADR 0009): append-only. No foreign key to `projects`, so spend stays counted
 * after a project is deleted.
 */
export const apiUsage = pgTable(
  "api_usage",
  {
    id: text("id").primaryKey(),
    service: text("service").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    operation: text("operation").notNull(),
    projectId: text("project_id"),
    jobId: text("job_id"),
    status: text("status").notNull(),
    estimatedUsd: doublePrecision("estimated_usd").notNull(),
    usd: doublePrecision("usd").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    characters: integer("characters"),
    message: text("message"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    index("api_usage_created_at_idx").on(table.createdAt),
    index("api_usage_project_id_idx").on(table.projectId),
    check("api_usage_status_check", sql`${table.status} in ('ok', 'failed', 'blocked')`),
  ],
);

/** Budgets from the settings page: a single row `id = 'default'` holding BudgetSettings. */
export const budgetSettings = pgTable("budget_settings", {
  id: text("id").primaryKey(),
  data: jsonb("data").$type<unknown>().notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});
