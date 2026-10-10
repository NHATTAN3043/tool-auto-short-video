import { createProject, scriptToScenes, type Project } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { FakeClock, InMemoryJobQueue, InMemoryProjectRepository } from "../testing";
import { makeRequestRender } from "./request-render";

async function setup(scenes: Project["scenes"]) {
  const repo = new InMemoryProjectRepository();
  const clock = new FakeClock("2026-04-01T00:00:00.000Z");
  const queue = new InMemoryJobQueue(clock);
  await repo.save({ ...createProject({ name: "P", mode: "manual" }, { newId: () => "prj_1" }), scenes });
  return { queue, requestRender: makeRequestRender({ repo, queue, clock, newId: () => "job_1" }) };
}

describe("requestRender", () => {
  it("queues a render job without rendering", async () => {
    const s = await setup(scriptToScenes("Một."));
    const job = await s.requestRender({ projectId: "prj_1" });
    expect(job).toEqual({
      id: "job_1",
      projectId: "prj_1",
      status: "QUEUED",
      progress: 0,
      createdAt: "2026-04-01T00:00:00.000Z",
    });
    expect(await s.queue.list({ status: "QUEUED" })).toEqual([job]);
  });

  it("returns the active job instead of queueing a duplicate", async () => {
    const repo = new InMemoryProjectRepository();
    const clock = new FakeClock("2026-04-01T00:00:00.000Z");
    const queue = new InMemoryJobQueue(clock);
    await repo.save({
      ...createProject({ name: "P", mode: "manual" }, { newId: () => "prj_1" }),
      scenes: scriptToScenes("Một."),
    });
    let n = 0;
    const requestRender = makeRequestRender({ repo, queue, clock, newId: () => `job_${String(++n)}` });

    const [first, second] = await Promise.all([
      requestRender({ projectId: "prj_1" }),
      requestRender({ projectId: "prj_1" }),
    ]);
    expect(second.id).toBe(first.id);
    await queue.claimNext();
    expect((await requestRender({ projectId: "prj_1" })).id).toBe(first.id);

    await queue.update(first.id, { status: "COMPLETED", progress: 1 });
    expect((await requestRender({ projectId: "prj_1" })).id).toBe("job_2");
    expect(await queue.list()).toHaveLength(2);
  });

  it("queues a CapCut export next to an active video render, but not twice", async () => {
    const repo = new InMemoryProjectRepository();
    const clock = new FakeClock("2026-04-01T00:00:00.000Z");
    const queue = new InMemoryJobQueue(clock);
    await repo.save({
      ...createProject({ name: "P", mode: "manual" }, { newId: () => "prj_1" }),
      scenes: scriptToScenes("Một."),
    });
    let n = 0;
    const requestRender = makeRequestRender({ repo, queue, clock, newId: () => `job_${String(++n)}` });

    const video = await requestRender({ projectId: "prj_1" });
    const capcut = await requestRender({ projectId: "prj_1", kind: "capcut" });
    expect(video).not.toHaveProperty("kind");
    expect(capcut).toMatchObject({ id: "job_2", kind: "capcut", status: "QUEUED" });
    expect((await requestRender({ projectId: "prj_1", kind: "capcut" })).id).toBe("job_2");
    expect((await requestRender({ projectId: "prj_1", kind: "video" })).id).toBe("job_1");
  });

  it("rejects a project without scenes or with broken asset references", async () => {
    await expect((await setup([])).requestRender({ projectId: "prj_1" })).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
    const broken = await setup([{ id: "scn_1", narration: "x", status: "draft", voiceAssetId: "ast_gone" }]);
    await expect(broken.requestRender({ projectId: "prj_1" })).rejects.toMatchObject({
      code: "ASSET_NOT_FOUND",
    });
    await expect(broken.queue.list()).resolves.toEqual([]);
  });

  it("rejects an unknown project", async () => {
    await expect((await setup([])).requestRender({ projectId: "prj_x" })).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
    });
  });
});
