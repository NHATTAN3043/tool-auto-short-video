import { createProject, type RenderJob } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { FakeClock, InMemoryJobQueue, InMemoryProjectRepository } from "../testing";
import { makeGetRenderJob, makeListRenderJobs } from "./list-render-jobs";

const job = (id: string, projectId: string, createdAt: string): RenderJob => ({
  id,
  projectId,
  status: "QUEUED",
  progress: 0,
  createdAt,
});

async function setup() {
  const repo = new InMemoryProjectRepository();
  const queue = new InMemoryJobQueue(new FakeClock());
  for (const id of ["prj_1", "prj_2"]) {
    await repo.save(createProject({ name: id, mode: "manual" }, { newId: () => id }));
  }
  await queue.enqueue(job("job_old", "prj_1", "2026-01-01T00:00:00.000Z"));
  await queue.enqueue(job("job_other", "prj_2", "2026-01-02T00:00:00.000Z"));
  await queue.enqueue(job("job_new", "prj_1", "2026-01-03T00:00:00.000Z"));
  return { list: makeListRenderJobs({ repo, queue }), get: makeGetRenderJob({ queue }) };
}

describe("render job queries", () => {
  it("lists the jobs of one project, newest first", async () => {
    const s = await setup();
    expect((await s.list({ projectId: "prj_1" })).map((j) => j.id)).toEqual(["job_new", "job_old"]);
    await expect(s.list({ projectId: "prj_x" })).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("gets a job only through its own project", async () => {
    const s = await setup();
    expect((await s.get({ projectId: "prj_1", jobId: "job_new" })).id).toBe("job_new");
    await expect(s.get({ projectId: "prj_1", jobId: "job_other" })).rejects.toMatchObject({
      code: "JOB_NOT_FOUND",
    });
    await expect(s.get({ projectId: "prj_1", jobId: "job_missing" })).rejects.toMatchObject({
      code: "JOB_NOT_FOUND",
    });
  });
});
