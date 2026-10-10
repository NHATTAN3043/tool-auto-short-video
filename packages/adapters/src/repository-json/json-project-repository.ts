import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { DomainError, migrateProject, ProjectSchema, type Project } from "@studio/domain";
import { KeyedLock, type ProjectRepository, type ProjectSummary } from "@studio/services";

const PROJECT_ID = /^prj_[A-Za-z0-9_-]+$/u;

/** Write-then-rename so a crash mid-write never leaves a corrupt project.json. */
async function writeFileAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, "utf8");
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** One `projects/<id>/project.json` per project (ADR 0001). Migrated on every read. */
export class JsonProjectRepository implements ProjectRepository {
  private readonly projectsDir: string;
  private readonly lock = new KeyedLock();

  constructor(rootDir: string) {
    this.projectsDir = path.resolve(rootDir, "projects");
  }

  async get(id: string): Promise<Project> {
    let text: string;
    try {
      text = await readFile(this.fileOf(id), "utf8");
    } catch (error) {
      if (isNotFound(error)) throw new DomainError("PROJECT_NOT_FOUND", `Project not found: ${id}`);
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new DomainError("INVALID_PROJECT", `project.json of ${id} is not valid JSON`);
    }
    return migrateProject(raw);
  }

  async list(): Promise<ProjectSummary[]> {
    let entries;
    try {
      entries = await readdir(this.projectsDir, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const summaries: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !PROJECT_ID.test(entry.name)) continue;
      try {
        const { id, name, mode, scenes, updatedAt } = await this.get(entry.name);
        summaries.push({ id, name, mode, sceneCount: scenes.length, updatedAt });
      } catch (error) {
        // One broken project must not hide all the others.
        console.warn(`Skipping unreadable project ${entry.name}: ${(error as Error).message}`);
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  save(project: Project): Promise<Project> {
    return this.lock.run(project.id, () => this.write(project));
  }

  update(id: string, mutate: (project: Project) => Project): Promise<Project> {
    return this.lock.run(id, async () => {
      const next = mutate(await this.get(id));
      if (next.id !== id) throw new DomainError("INVALID_OPERATION", "A project id cannot change");
      return this.write(next);
    });
  }

  remove(id: string): Promise<void> {
    return this.lock.run(id, async () => {
      try {
        await rm(this.fileOf(id));
      } catch (error) {
        if (isNotFound(error)) throw new DomainError("PROJECT_NOT_FOUND", `Project not found: ${id}`);
        throw error;
      }
    });
  }

  private async write(project: Project): Promise<Project> {
    const parsed = ProjectSchema.safeParse(project);
    if (!parsed.success) {
      throw new DomainError("INVALID_PROJECT", parsed.error.issues.map((issue) => issue.message).join("; "));
    }
    await writeFileAtomic(this.fileOf(parsed.data.id), `${JSON.stringify(parsed.data, null, 2)}\n`);
    return parsed.data;
  }

  private fileOf(id: string): string {
    // The id becomes a directory name, so it must never contain path syntax.
    if (!PROJECT_ID.test(id)) throw new DomainError("PROJECT_NOT_FOUND", `Invalid project id: ${id}`);
    return path.join(this.projectsDir, id, "project.json");
  }
}
