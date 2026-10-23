import { and, asc, eq, sql, type SQL } from "drizzle-orm";

import { DomainError, RenderJobSchema, type RenderJob } from "@studio/domain";
import {
  systemClock,
  type Clock,
  type JobFilter,
  type JobQueuePort,
  type RenderJobPatch,
} from "@studio/services";

import { isUniqueViolation, type PgDb } from "./database";
import { renderJobs } from "./schema";

const JOB_ID = /^job_[A-Za-z0-9_-]+$/u;

type JobRow = typeof renderJobs.$inferSelect;
type JobInsert = typeof renderJobs.$inferInsert;

const dateOrNull = (value: string | undefined): Date | null => (value === undefined ? null : new Date(value));

function toRow(job: RenderJob): JobInsert {
  return {
    id: job.id,
    projectId: job.projectId,
    kind: job.kind ?? null,
    sceneIds: job.sceneIds ?? null,
    ai: job.ai ?? null,
    fullAi: job.fullAi ?? null,
    voice: job.voice ?? null,
    clip: job.clip ?? null,
    status: job.status,
    progress: job.progress,
    outputPath: job.outputPath ?? null,
    srtPath: job.srtPath ?? null,
    errorMessage: job.errorMessage ?? null,
    createdAt: new Date(job.createdAt),
    startedAt: dateOrNull(job.startedAt),
    completedAt: dateOrNull(job.completedAt),
  };
}

/** Null columns become missing keys, exactly like a job read from its JSON file. */
function fromRow(row: JobRow): RenderJob {
  return RenderJobSchema.parse({
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    progress: row.progress,
    createdAt: row.createdAt.toISOString(),
    ...(row.kind !== null && { kind: row.kind }),
    ...(row.sceneIds !== null && { sceneIds: row.sceneIds }),
    ...(row.ai !== null && { ai: row.ai }),
    ...(row.fullAi !== null && { fullAi: row.fullAi }),
    ...(row.voice !== null && { voice: row.voice }),
    ...(row.clip !== null && { clip: row.clip }),
    ...(row.outputPath !== null && { outputPath: row.outputPath }),
    ...(row.srtPath !== null && { srtPath: row.srtPath }),
    ...(row.errorMessage !== null && { errorMessage: row.errorMessage }),
    ...(row.startedAt !== null && { startedAt: row.startedAt.toISOString() }),
    ...(row.completedAt !== null && { completedAt: row.completedAt.toISOString() }),
  });
}

function notFound(id: string): DomainError {
  return new DomainError("JOB_NOT_FOUND", `Job not found: ${id}`);
}

/**
 * Render jobs in `render_jobs` (ADR 0005). `claimNext` uses `FOR UPDATE SKIP LOCKED`, so several workers
 * never claim the same job.
 */
export class PgJobQueue implements JobQueuePort {
  constructor(
    private readonly db: PgDb,
    private readonly clock: Clock = systemClock,
  ) {}

  async enqueue(job: RenderJob): Promise<RenderJob> {
    const parsed = RenderJobSchema.parse(job);
    if (!JOB_ID.test(parsed.id)) throw notFound(parsed.id);
    try {
      await this.db.insert(renderJobs).values(toRow(parsed));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError("INVALID_OPERATION", `Job already exists: ${parsed.id}`);
      }
      throw error;
    }
    return parsed;
  }

  async get(id: string): Promise<RenderJob> {
    const [row] = await this.db.select().from(renderJobs).where(eq(renderJobs.id, id));
    if (!row) throw notFound(id);
    return fromRow(row);
  }

  async list(filter: JobFilter = {}): Promise<RenderJob[]> {
    const conditions: SQL[] = [];
    if (filter.projectId !== undefined) conditions.push(eq(renderJobs.projectId, filter.projectId));
    if (filter.status !== undefined) conditions.push(eq(renderJobs.status, filter.status));
    const rows = await this.db
      .select()
      .from(renderJobs)
      .where(and(...conditions))
      .orderBy(asc(renderJobs.createdAt), asc(renderJobs.id));
    return rows.map(fromRow);
  }

  async claimNext(): Promise<RenderJob | null> {
    const oldestQueued = this.db
      .select({ id: renderJobs.id })
      .from(renderJobs)
      .where(eq(renderJobs.status, "QUEUED"))
      .orderBy(asc(renderJobs.createdAt), asc(renderJobs.id))
      .limit(1)
      .for("update", { skipLocked: true });
    const [row] = await this.db
      .update(renderJobs)
      .set({ status: "PROCESSING", startedAt: new Date(this.clock.now()) })
      .where(eq(renderJobs.id, sql`(${oldestQueued})`))
      .returning();
    return row ? fromRow(row) : null;
  }

  update(id: string, patch: RenderJobPatch): Promise<RenderJob> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(renderJobs).where(eq(renderJobs.id, id)).for("update");
      if (!row) throw notFound(id);
      const next = RenderJobSchema.parse({ ...fromRow(row), ...patch, id });
      await tx.update(renderJobs).set(toRow(next)).where(eq(renderJobs.id, id));
      return next;
    });
  }

  async removeForProject(projectId: string): Promise<void> {
    await this.db.delete(renderJobs).where(eq(renderJobs.projectId, projectId));
  }
}
