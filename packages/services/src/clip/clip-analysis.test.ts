import {
  createProject,
  DomainError,
  uploadSourceRef,
  type ClipAnalysis,
  type LibraryMedia,
  type RenderJob,
} from "@studio/domain";
import { describe, expect, it } from "vitest";

import { makeRemoveLibraryMedia } from "../media-search/media-library";
import { AiCallError } from "../ports/ai";
import { makeRunNextRenderJob } from "../render/run-next-render-job";
import {
  FakeAi,
  FakeClipFrames,
  FakeClock,
  FakeCostGuard,
  FakeMediaProbe,
  InMemoryJobQueue,
  InMemoryMediaLibrary,
  InMemoryProjectRepository,
  InMemoryStorage,
  oneChunk,
} from "../testing";
import { makeAnalyzeClips } from "./analyze-clips";
import { makeEstimateClipAnalysis, makeRequestClipAnalysis } from "./request-clip-analysis";

const clip = (id: string, extra: Partial<LibraryMedia> = {}): LibraryMedia => ({
  id,
  kind: "video",
  fileName: `${id}.mp4`,
  path: `files/${id}.mp4`,
  durationMs: 9000,
  tags: [],
  usageCount: 0,
  source: "upload",
  sourceRef: uploadSourceRef(`sha256:${id}`),
  contentHash: `sha256:${id}`,
  createdAt: "2026-10-23T00:00:00.000Z",
  ...extra,
});

const oldAnalysis = (id: string): ClipAnalysis => ({
  shots: [
    {
      index: 0,
      startMs: 0,
      endMs: 9000,
      description: "Cũ",
      tags: ["old"],
      textOverlay: false,
      thumbnailPath: `shots/${id}/job_old/frame-000.jpg`,
    },
  ],
  model: "old-model",
  analyzedAt: "2026-10-01T00:00:00.000Z",
});

async function setup() {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const library = new InMemoryMediaLibrary();
  const queue = new InMemoryJobQueue();
  const clock = new FakeClock("2026-10-23T10:00:00.000Z");
  const costGuard = new FakeCostGuard(undefined, clock);
  const ai = new FakeAi();
  const frames = new FakeClipFrames(storage);
  const probeResult = { kind: "video" as const, durationMs: 9000, hasAudio: true };
  const probe = new FakeMediaProbe(storage, { mp4: probeResult });
  frames.cuts = [2000, 5000];
  await repo.save(createProject({ name: "P", mode: "manual" }, { newId: () => "prj_1" }));
  for (const item of [clip("lib_a"), clip("lib_b"), clip("lib_img", { kind: "image" })]) {
    await library.add(item);
    await storage.write(`library/media/${item.path}`, oneChunk(new Uint8Array([1])));
  }
  let jobs = 0;
  const deps = { repo, library, ai, costGuard };
  const analyze = makeAnalyzeClips({ library, storage, frames, probe, ai: () => ai, clock });
  const run = makeRunNextRenderJob({
    queue,
    renderProject: () => Promise.reject(new Error("not a render")),
    exportCapcut: () => Promise.reject(new Error("not a render")),
    analyzeClips: analyze,
    clock,
  });
  return {
    repo,
    storage,
    library,
    queue,
    costGuard,
    ai,
    frames,
    probe,
    probeResult,
    analyze,
    run,
    estimate: makeEstimateClipAnalysis(deps),
    request: makeRequestClipAnalysis({ ...deps, queue, clock, newId: () => `job_${String(++jobs)}` }),
  };
}

const shotFiles = (storage: InMemoryStorage) =>
  [...storage.files.keys()].filter((key) => key.startsWith("library/media/shots/")).sort();

const clipJob = (libraryIds: string[], extra: Partial<NonNullable<RenderJob["clip"]>> = {}): RenderJob => ({
  id: "job_1",
  projectId: "prj_1",
  kind: "clip",
  clip: { libraryIds, maxUsd: 1, ...extra },
  status: "PROCESSING",
  progress: 0,
  createdAt: "2026-10-23T10:00:00.000Z",
});

describe("estimating and queuing a clip analysis", () => {
  it("prices each video from its length and says which ones are left out", async () => {
    const s = await setup();
    await s.library.setAnalysis("lib_b", oldAnalysis("lib_b"));
    const cost = await s.estimate({
      projectId: "prj_1",
      libraryIds: ["lib_a", "lib_b", "lib_img", "lib_gone"],
    });

    // 9s: about 2 shots expected, at most 7 (one per 1.2s).
    expect(cost.clips).toEqual([{ id: "lib_a", fileName: "lib_a.mp4", durationMs: 9000, expectedShots: 2 }]);
    expect(cost.skipped).toEqual([
      { id: "lib_b", reason: "analyzed" },
      { id: "lib_img", reason: "not_video" },
      { id: "lib_gone", reason: "not_found" },
    ]);
    expect(cost.expectedUsd).toBeCloseTo(0.002);
    expect(cost.maxUsd).toBeCloseTo(0.014);
    expect(cost.budget.allowed).toBe(true);

    const again = await s.estimate({ projectId: "prj_1", libraryIds: ["lib_b"], reanalyze: true });
    expect(again.clips.map((c) => c.id)).toEqual(["lib_b"]);
  });

  it("queues one job for the videos to analyze, and returns it again while it is active", async () => {
    const s = await setup();
    const job = await s.request({ projectId: "prj_1", libraryIds: ["lib_a", "lib_b", "lib_img"] });
    expect(job).toMatchObject({
      kind: "clip",
      projectId: "prj_1",
      status: "QUEUED",
      clip: { libraryIds: ["lib_a", "lib_b"] },
    });
    expect(job.clip?.maxUsd).toBeCloseTo(0.028);
    expect(await s.request({ projectId: "prj_1", libraryIds: ["lib_b"] })).toEqual(job);
    expect(await s.queue.list()).toHaveLength(1);
  });

  it("refuses when nothing is left to analyze, or when the worst case breaks a budget", async () => {
    const s = await setup();
    await expect(s.request({ projectId: "prj_1", libraryIds: ["lib_img"] })).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
    s.costGuard.limits = { ...s.costGuard.limits, perCallUsd: 0.001 };
    await expect(s.request({ projectId: "prj_1", libraryIds: ["lib_a"] })).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
    });
    expect(await s.queue.list()).toEqual([]);
  });
});

describe("analyzing clips in the worker", () => {
  it("re-probes an old library duration before picking frames or describing shots", async () => {
    const s = await setup();
    await s.library.add(clip("lib_old", { durationMs: 62_037 }));
    s.probeResult.durationMs = 57_367;
    s.frames.cuts = [55_000, 58_000, 60_000];
    const result = await s.analyze({ job: clipJob(["lib_old"]) });
    expect(result.failed).toEqual([]);
    expect(result.analyzed).toEqual(["lib_old"]);
    const request = s.ai.shotCalls[0]?.input;
    expect(request?.durationMs).toBe(57_367);
    expect(request?.shots.at(-1)?.endMs).toBe(57_367);
    expect(request?.shots.every((shot) => shot.endMs <= 57_367)).toBe(true);
    expect(s.frames.grabbed[0]?.atMs.every((ms) => ms < 57_367)).toBe(true);
    // No bulk rewrite: only the saved analysis uses the corrected duration.
    expect((await s.library.get("lib_old")).durationMs).toBe(62_037);
  });

  it("fails before the AI call when the file is unreadable or has no usable picture duration", async () => {
    const s = await setup();
    s.probe.failProbe = true;
    expect((await s.analyze({ job: clipJob(["lib_a"]) })).failed[0]?.message).toContain("unreadable");
    s.probe.failProbe = false;
    s.probeResult.durationMs = 0;
    expect((await s.analyze({ job: clipJob(["lib_a"]) })).failed[0]?.message).toContain("thời lượng hình");
    expect(s.frames.grabbed).toEqual([]);
    expect(s.ai.shotCalls).toEqual([]);
    expect(shotFiles(s.storage)).toEqual([]);
  });

  it("cuts each video into shots, keeps a still per shot and saves what the AI says", async () => {
    const s = await setup();
    const progress: number[] = [];
    const result = await s.analyze({ job: clipJob(["lib_a"]), onProgress: (p) => progress.push(p) });

    expect(result).toEqual({ analyzed: ["lib_a"], skipped: [], failed: [], costUsd: 0.007 });
    expect(progress).toEqual([1]);
    expect(s.frames.grabbed[0]?.atMs).toEqual([1000, 3500, 7000]);
    expect(s.frames.grabbed[0]?.options).toEqual({ maxSide: 480 });
    expect(s.ai.shotCalls[0]?.input).toEqual({
      fileName: "lib_a.mp4",
      durationMs: 9000,
      shots: [
        { startMs: 0, endMs: 2000 },
        { startMs: 2000, endMs: 5000 },
        { startMs: 5000, endMs: 9000 },
      ],
    });
    expect(s.ai.shotCalls[0]?.frames).toHaveLength(3);
    expect(s.ai.shotCalls[0]?.frames[0]).toMatchObject({ type: "base64", mediaType: "image/jpeg" });

    const analysis = (await s.library.get("lib_a")).analysis;
    expect(analysis?.model).toBe("fake-model");
    expect(analysis?.analyzedAt).toBe("2026-10-23T10:00:00.000Z");
    expect(analysis?.shots[1]).toEqual({
      index: 1,
      startMs: 2000,
      endMs: 5000,
      description: "Đoạn 1 của lib_a.mp4",
      tags: ["shot 1"],
      textOverlay: false,
      thumbnailPath: "shots/lib_a/job_1/frame-001.jpg",
    });
    expect(shotFiles(s.storage)).toEqual([
      "library/media/shots/lib_a/job_1/frame-000.jpg",
      "library/media/shots/lib_a/job_1/frame-001.jpg",
      "library/media/shots/lib_a/job_1/frame-002.jpg",
    ]);
  });

  it("refuses an answer that loses track of the shots: no analysis, no stills, cost still counted", async () => {
    const s = await setup();
    s.ai.shotAnswer = () => ({
      shots: [{ index: 0, description: "Chỉ một", tags: [], textOverlay: false }],
    });
    const result = await s.analyze({ job: clipJob(["lib_a"]) });

    expect(result.failed).toEqual([
      { id: "lib_a", message: expect.stringMatching(/^lib_a\.mp4: .*3 đoạn/u) as string },
    ]);
    expect(result.costUsd).toBe(0.007);
    expect((await s.library.get("lib_a")).analysis).toBeUndefined();
    expect(shotFiles(s.storage)).toEqual([]);
  });

  it("goes on with the next video when one fails, counting what a failed call was billed", async () => {
    const s = await setup();
    s.frames.failOn = "lib_a";
    const first = await s.analyze({ job: clipJob(["lib_a", "lib_b"]) });
    expect(first.analyzed).toEqual(["lib_b"]);
    expect(first.failed[0]?.message).toMatch(/ffmpeg failed/u);

    s.frames.failOn = null;
    s.ai.failWith = new AiCallError("AI_INVALID_OUTPUT", "bị cắt", {
      inputTokens: 1,
      outputTokens: 1,
      usd: 0.003,
    });
    const second = await s.analyze({ job: clipJob(["lib_a"]) });
    expect(second).toMatchObject({ analyzed: [], costUsd: 0.003 });
    expect(second.failed[0]?.message).toMatch(/không dùng được: bị cắt/u);
  });

  it("skips videos already analyzed, unless asked again; a new analysis replaces the old stills", async () => {
    const s = await setup();
    await s.library.setAnalysis("lib_a", oldAnalysis("lib_a"));
    await s.storage.write("library/media/shots/lib_a/job_old/frame-000.jpg", oneChunk(new Uint8Array([1])));

    expect(await s.analyze({ job: clipJob(["lib_a", "lib_img", "lib_gone"]) })).toMatchObject({
      analyzed: [],
      skipped: ["lib_a", "lib_img", "lib_gone"],
    });
    expect(s.ai.shotCalls).toEqual([]);

    await s.analyze({ job: clipJob(["lib_a"], { reanalyze: true }) });
    expect((await s.library.get("lib_a")).analysis?.model).toBe("fake-model");
    expect(shotFiles(s.storage).every((key) => key.includes("/job_1/"))).toBe(true);
  });

  it("drops the stills of a video removed from the library while the job ran", async () => {
    const s = await setup();
    s.library.setAnalysis = () =>
      Promise.reject(new DomainError("LIBRARY_MEDIA_NOT_FOUND", "Library media not found: lib_a"));
    expect(await s.analyze({ job: clipJob(["lib_a"]) })).toMatchObject({ analyzed: [], skipped: ["lib_a"] });
    expect(shotFiles(s.storage)).toEqual([]);
  });

  it("finishes the job with its real cost, and fails it with the reason when a video failed", async () => {
    const s = await setup();
    await s.request({ projectId: "prj_1", libraryIds: ["lib_a"] });
    expect(await s.run()).toMatchObject({ status: "COMPLETED", progress: 1, clip: { costUsd: 0.007 } });

    s.frames.failOn = "lib_b";
    await s.request({ projectId: "prj_1", libraryIds: ["lib_b"] });
    const failed = await s.run();
    expect(failed).toMatchObject({ status: "FAILED", clip: { costUsd: 0 } });
    expect(failed?.errorMessage).toMatch(/^Không phân tích được 1\/1 video: lib_b\.mp4/u);
  });

  it("fails a clip job clearly on a worker without AI", async () => {
    const s = await setup();
    await s.request({ projectId: "prj_1", libraryIds: ["lib_a"] });
    const run = makeRunNextRenderJob({
      queue: s.queue,
      renderProject: () => Promise.reject(new Error("x")),
      exportCapcut: () => Promise.reject(new Error("x")),
      clock: new FakeClock(),
    });
    expect((await run())?.errorMessage).toMatch(/ANTHROPIC_API_KEY/u);
  });
});

describe("removing a library video", () => {
  it("removes the stills of its shots too", async () => {
    const s = await setup();
    await s.analyze({ job: clipJob(["lib_a"]) });
    await makeRemoveLibraryMedia({ library: s.library, storage: s.storage })("lib_a");
    expect(shotFiles(s.storage)).toEqual([]);
  });
});
