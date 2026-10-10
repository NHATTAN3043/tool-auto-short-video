import { createProject, scriptToScenes, type Project, type RenderJob } from "@studio/domain";
import { describe, expect, it } from "vitest";

import {
  FakeArchive,
  FakeClipCutter,
  FakeClock,
  FakeRenderer,
  InMemoryJobQueue,
  InMemoryProjectRepository,
  InMemoryStorage,
} from "../testing";
import { makeExportCapcut } from "./export-capcut";
import { makeFailStaleJobs, STALE_JOB_MESSAGE } from "./fail-stale-jobs";
import { makeRenderProject } from "./render-project";
import { makeRunNextRenderJob } from "./run-next-render-job";

const queued = (id: string, createdAt = "2026-01-01T00:00:00.000Z"): RenderJob => ({
  id,
  projectId: "prj_1",
  status: "QUEUED",
  progress: 0,
  createdAt,
});

async function setup(scenes: Project["scenes"] = scriptToScenes("Xin chào các bạn.\n\nTạm biệt.")) {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const renderer = new FakeRenderer();
  const clock = new FakeClock("2026-05-01T00:00:00.000Z");
  const queue = new InMemoryJobQueue(clock);
  await repo.save({ ...createProject({ name: "P", mode: "manual" }, { newId: () => "prj_1" }), scenes });
  const renderProject = makeRenderProject({ repo, storage, renderer });
  const cutter = new FakeClipCutter();
  const archive = new FakeArchive(storage);
  const exportCapcut = makeExportCapcut({ repo, storage, renderer, cutter, archive });
  return { repo, storage, renderer, cutter, archive, clock, queue, renderProject, exportCapcut };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const runner = (s: Setup) =>
  makeRunNextRenderJob({
    queue: s.queue,
    renderProject: s.renderProject,
    exportCapcut: s.exportCapcut,
    clock: s.clock,
  });

describe("renderProject", () => {
  it("renders into the project's render folder and writes the SRT next to it", async () => {
    const s = await setup();
    const progress: number[] = [];
    const result = await s.renderProject({
      projectId: "prj_1",
      outputName: "job_1",
      onProgress: (p) => progress.push(p),
    });

    expect(result).toEqual({ videoPath: "render/job_1.mp4", srtPath: "render/job_1.srt" });
    expect(s.renderer.requests[0]).toMatchObject({
      project: { id: "prj_1" },
      projectDir: "/memory/projects/prj_1",
      outputPath: "/memory/projects/prj_1/render/job_1.mp4",
    });
    expect(progress).toEqual([0.25, 0.5, 1]);
    const srt = new TextDecoder().decode(s.storage.files.get("projects/prj_1/render/job_1.srt"));
    expect(srt).toMatch(/^1\n00:00:00,000 --> /u);
    expect(srt).toContain("Xin chào các bạn.");
  });

  it("rejects empty projects and unsafe output names", async () => {
    await expect(
      (await setup([])).renderProject({ projectId: "prj_1", outputName: "x" }),
    ).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
    const s = await setup();
    await expect(s.renderProject({ projectId: "prj_1", outputName: "../evil" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(s.renderer.requests).toEqual([]);
  });

  it("writes no SRT when the render fails", async () => {
    const s = await setup();
    s.renderer.failWith = new Error("chrome crashed");
    await expect(s.renderProject({ projectId: "prj_1", outputName: "job_1" })).rejects.toThrow(
      "chrome crashed",
    );
    expect(s.storage.files.size).toBe(0);
  });
});

describe("runNextRenderJob", () => {
  it("returns null when nothing is queued", async () => {
    const s = await setup();
    const run = runner(s);
    expect(await run()).toBeNull();
  });

  it("renders the oldest job and marks it COMPLETED", async () => {
    const s = await setup();
    await s.queue.enqueue(queued("job_late", "2026-01-02T00:00:00.000Z"));
    await s.queue.enqueue(queued("job_early"));
    const run = runner(s);

    expect(await run()).toEqual({
      ...queued("job_early"),
      status: "COMPLETED",
      progress: 1,
      outputPath: "render/job_early.mp4",
      srtPath: "render/job_early.srt",
      startedAt: "2026-05-01T00:00:00.000Z",
      completedAt: "2026-05-01T00:00:00.000Z",
    });
    expect((await s.queue.get("job_late")).status).toBe("QUEUED");
  });

  it("marks the job FAILED with the error message", async () => {
    const s = await setup();
    s.renderer.failWith = new Error("Không tải được video");
    await s.queue.enqueue(queued("job_1"));
    const run = runner(s);
    expect(await run()).toMatchObject({ status: "FAILED", errorMessage: "Không tải được video" });
  });

  it("builds the CapCut package for capcut jobs", async () => {
    const s = await setup();
    await s.queue.enqueue({ ...queued("job_1"), kind: "capcut" });
    expect(await runner(s)()).toMatchObject({
      kind: "capcut",
      status: "COMPLETED",
      outputPath: "render/job_1.zip",
      srtPath: "render/job_1.srt",
    });
    expect(s.archive.archives).toHaveLength(1);
  });

  it("saves progress at most once per interval and never reports 1 before completion", async () => {
    const s = await setup();
    await s.queue.enqueue(queued("job_1"));
    const saved: number[] = [];
    const update = s.queue.update.bind(s.queue);
    s.queue.update = (id, patch) => {
      if (patch.progress !== undefined && patch.status === undefined) saved.push(patch.progress);
      return update(id, patch);
    };
    let tick = 0;
    const clock = { now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 400 * tick++)).toISOString() };
    const steps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
    const renderer = new FakeRenderer(steps);
    const renderProject = makeRenderProject({ repo: s.repo, storage: s.storage, renderer });

    const job = await makeRunNextRenderJob({
      queue: s.queue,
      renderProject,
      exportCapcut: s.exportCapcut,
      clock,
      progressIntervalMs: 1000,
    })();
    // Clock advances 400ms per call: steps at 0, 400, 800, 1200, … ms → a write every third step.
    expect(saved).toEqual([0.1, 0.4, 0.7, 0.99]);
    expect(job?.progress).toBe(1);
  });
});

describe("failStaleJobs", () => {
  it("fails only jobs left PROCESSING by a dead worker", async () => {
    const s = await setup();
    await s.queue.enqueue(queued("job_stuck"));
    await s.queue.enqueue(queued("job_waiting", "2026-01-02T00:00:00.000Z"));
    await s.queue.claimNext();

    expect(await makeFailStaleJobs({ queue: s.queue, clock: s.clock })()).toBe(1);
    expect(await s.queue.get("job_stuck")).toMatchObject({
      status: "FAILED",
      errorMessage: STALE_JOB_MESSAGE,
    });
    expect((await s.queue.get("job_waiting")).status).toBe("QUEUED");
  });
});
