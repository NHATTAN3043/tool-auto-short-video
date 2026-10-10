import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { DomainError, RenderJobSchema, type RenderJob } from "@studio/domain";
import {
  KeyedLock,
  systemClock,
  type Clock,
  type JobFilter,
  type JobQueuePort,
  type RenderJobPatch,
} from "@studio/services";

const JOB_ID = /^job_[A-Za-z0-9_-]+$/u;

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

/**
 * One `jobs/<id>.json` per render job. Claiming is serialized inside this process only, so run a single
 * worker; switching to pg-boss/BullMQ later is a new adapter with the same port.
 */
export class FileJobQueue implements JobQueuePort {
  private readonly jobsDir: string;
  private readonly lock = new KeyedLock();

  constructor(
    rootDir: string,
    private readonly clock: Clock = systemClock,
  ) {
    this.jobsDir = path.resolve(rootDir, "jobs");
  }

  enqueue(job: RenderJob): Promise<RenderJob> {
    return this.lock.run(job.id, async () => {
      const parsed = RenderJobSchema.parse(job);
      const exists = await this.get(parsed.id).then(
        () => true,
        () => false,
      );
      if (exists) throw new DomainError("INVALID_OPERATION", `Job already exists: ${parsed.id}`);
      await this.write(parsed);
      return parsed;
    });
  }

  async get(id: string): Promise<RenderJob> {
    let text: string;
    try {
      text = await readFile(this.fileOf(id), "utf8");
    } catch (error) {
      if (isNotFound(error)) throw new DomainError("JOB_NOT_FOUND", `Job not found: ${id}`);
      throw error;
    }
    return RenderJobSchema.parse(JSON.parse(text));
  }

  async list(filter: JobFilter = {}): Promise<RenderJob[]> {
    let names: string[];
    try {
      names = await readdir(this.jobsDir);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const jobs: RenderJob[] = [];
    for (const name of names) {
      const id = name.replace(/\.json$/u, "");
      if (id === name || !JOB_ID.test(id)) continue;
      try {
        jobs.push(await this.get(id));
      } catch (error) {
        console.warn(`Skipping unreadable job ${name}: ${(error as Error).message}`);
      }
    }
    return jobs
      .filter((job) => filter.projectId === undefined || job.projectId === filter.projectId)
      .filter((job) => filter.status === undefined || job.status === filter.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  claimNext(): Promise<RenderJob | null> {
    return this.lock.run("__claim__", async () => {
      const [next] = await this.list({ status: "QUEUED" });
      return next ? this.update(next.id, { status: "PROCESSING", startedAt: this.clock.now() }) : null;
    });
  }

  update(id: string, patch: RenderJobPatch): Promise<RenderJob> {
    return this.lock.run(id, async () => {
      const next = RenderJobSchema.parse({ ...(await this.get(id)), ...patch, id });
      await this.write(next);
      return next;
    });
  }

  async removeForProject(projectId: string): Promise<void> {
    for (const job of await this.list({ projectId })) {
      await this.lock.run(job.id, () => rm(this.fileOf(job.id), { force: true }));
    }
  }

  private write(job: RenderJob): Promise<void> {
    return writeFileAtomic(this.fileOf(job.id), `${JSON.stringify(job, null, 2)}\n`);
  }

  private fileOf(id: string): string {
    if (!JOB_ID.test(id)) throw new DomainError("JOB_NOT_FOUND", `Invalid job id: ${id}`);
    return path.join(this.jobsDir, `${id}.json`);
  }
}
