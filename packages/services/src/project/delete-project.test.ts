import { createProject, type RenderJob, type RenderJobStatus } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { InMemoryJobQueue, InMemoryProjectRepository, InMemoryStorage, oneChunk } from "../testing";
import { makeDeleteProject } from "./delete-project";

const job = (id: string, projectId: string, status: RenderJobStatus): RenderJob => ({
  id,
  projectId,
  status,
  progress: 0,
  createdAt: "2026-10-10T00:00:00.000Z",
});

async function setup() {
  const repo = new InMemoryProjectRepository();
  const queue = new InMemoryJobQueue();
  const storage = new InMemoryStorage();
  for (const id of ["prj_1", "prj_2"]) {
    await repo.save(createProject({ name: id, mode: "manual" }, { newId: () => id }));
    await storage.write(`projects/${id}/media/a.mp4`, oneChunk(new Uint8Array([1])));
    await storage.write(`projects/${id}/renders/r.mp4`, oneChunk(new Uint8Array([2])));
  }
  await storage.write("library/media/x.mp4", oneChunk(new Uint8Array([3])));
  await queue.enqueue(job("job_1", "prj_1", "COMPLETED"));
  await queue.enqueue(job("job_2", "prj_2", "COMPLETED"));
  return { repo, queue, storage, remove: makeDeleteProject({ repo, queue, storage }) };
}

describe("deleteProject", () => {
  it("deletes the record, the jobs and the files of that project only", async () => {
    const s = await setup();
    await s.remove("prj_1");

    await expect(s.repo.get("prj_1")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect((await s.repo.list()).map((project) => project.id)).toEqual(["prj_2"]);
    expect((await s.queue.list()).map((item) => item.id)).toEqual(["job_2"]);
    expect([...s.storage.files.keys()].sort()).toEqual([
      "library/media/x.mp4",
      "projects/prj_2/media/a.mp4",
      "projects/prj_2/renders/r.mp4",
    ]);
  });

  it.each<RenderJobStatus>(["QUEUED", "PROCESSING"])(
    "refuses while a job is %s and keeps everything",
    async (status) => {
      const s = await setup();
      await s.queue.enqueue(job("job_3", "prj_1", status));
      await expect(s.remove("prj_1")).rejects.toMatchObject({ code: "PROJECT_BUSY" });
      expect((await s.repo.get("prj_1")).id).toBe("prj_1");
      expect(await s.storage.exists("projects/prj_1/media/a.mp4")).toBe(true);
      expect(await s.queue.list({ projectId: "prj_1" })).toHaveLength(2);
    },
  );

  it("deletes once a job failed or was cancelled", async () => {
    const s = await setup();
    await s.queue.enqueue(job("job_3", "prj_1", "FAILED"));
    await s.queue.enqueue(job("job_4", "prj_1", "CANCELLED"));
    await s.remove("prj_1");
    expect(await s.queue.list({ projectId: "prj_1" })).toEqual([]);
  });

  it("throws PROJECT_NOT_FOUND for an unknown or already deleted project", async () => {
    const s = await setup();
    await expect(s.remove("prj_nope")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await s.remove("prj_1");
    await expect(s.remove("prj_1")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});
