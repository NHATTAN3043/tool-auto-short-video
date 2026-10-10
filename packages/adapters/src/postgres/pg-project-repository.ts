import { desc, eq } from "drizzle-orm";

import { DomainError, migrateProject, ProjectSchema, type Project } from "@studio/domain";
import type { ProjectRepository, ProjectSummary } from "@studio/services";

import type { PgDb } from "./database";
import { projects } from "./schema";

type Executor = Pick<PgDb, "insert">;

// Same rule as the JSON repository: the id also names the project's storage folder, so no path syntax.
const PROJECT_ID = /^prj_[A-Za-z0-9_-]+$/u;

function notFound(id: string): DomainError {
  return new DomainError("PROJECT_NOT_FOUND", `Project not found: ${id}`);
}

function validate(project: Project): Project {
  if (!PROJECT_ID.test(project.id)) throw notFound(project.id);
  const parsed = ProjectSchema.safeParse(project);
  if (!parsed.success) {
    throw new DomainError("INVALID_PROJECT", parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}

/** Writes the whole project as JSONB plus the summary columns that `list()` reads. */
async function upsert(executor: Executor, project: Project): Promise<void> {
  const row = {
    id: project.id,
    name: project.name,
    mode: project.mode,
    sceneCount: project.scenes.length,
    schemaVersion: project.schemaVersion,
    data: project,
    updatedAt: new Date(project.updatedAt),
  };
  await executor.insert(projects).values(row).onConflictDoUpdate({ target: projects.id, set: row });
}

/** One row per project in `projects` (ADR 0005). Migrated on every read, like the JSON repository. */
export class PgProjectRepository implements ProjectRepository {
  constructor(private readonly db: PgDb) {}

  async get(id: string): Promise<Project> {
    if (!PROJECT_ID.test(id)) throw notFound(id);
    const [row] = await this.db.select({ data: projects.data }).from(projects).where(eq(projects.id, id));
    if (!row) throw notFound(id);
    return migrateProject(row.data);
  }

  async list(): Promise<ProjectSummary[]> {
    const rows = await this.db
      .select({
        id: projects.id,
        name: projects.name,
        mode: projects.mode,
        sceneCount: projects.sceneCount,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .orderBy(desc(projects.updatedAt), projects.id);
    const summaries: ProjectSummary[] = [];
    for (const row of rows) {
      const mode = ProjectSchema.shape.mode.safeParse(row.mode);
      if (!mode.success) {
        console.warn(`Skipping project ${row.id} with unknown mode ${row.mode}`);
        continue;
      }
      summaries.push({ ...row, mode: mode.data, updatedAt: row.updatedAt.toISOString() });
    }
    return summaries;
  }

  async save(project: Project): Promise<Project> {
    const parsed = validate(project);
    await upsert(this.db, parsed);
    return parsed;
  }

  update(id: string, mutate: (project: Project) => Project): Promise<Project> {
    // The row lock makes concurrent updates from the web app and the worker run one after another.
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ data: projects.data })
        .from(projects)
        .where(eq(projects.id, id))
        .for("update");
      if (!row) throw notFound(id);
      const next = mutate(migrateProject(row.data));
      if (next.id !== id) throw new DomainError("INVALID_OPERATION", "A project id cannot change");
      const parsed = validate(next);
      await upsert(tx, parsed);
      return parsed;
    });
  }

  /** Its `render_jobs` rows go too (on delete cascade). */
  async remove(id: string): Promise<void> {
    if (!PROJECT_ID.test(id)) throw notFound(id);
    const deleted = await this.db.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
    if (deleted.length === 0) throw notFound(id);
  }
}
