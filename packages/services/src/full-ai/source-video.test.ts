import {
  createProject,
  MODE_PRESETS,
  uploadSourceRef,
  type ClipAnalysis,
  type FullAiRequest,
  type MediaAsset,
} from "@studio/domain";
import { describe, expect, it } from "vitest";

import { makeResolveRankImages } from "../ai/rank-images";
import { makeAddUploadToLibrary } from "../media-search/add-upload-to-library";
import { makeImportCandidate } from "../media-search/import-candidate";
import { makeSearchMedia } from "../media-search/search-media";
import { makeRunNextRenderJob } from "../render/run-next-render-job";
import {
  FakeAi,
  FakeClipFrames,
  FakeClock,
  FakeCostGuard,
  FakeMediaProbe,
  FakeMediaSearch,
  FakeRemoteFiles,
  FakeTts,
  InMemoryJobQueue,
  InMemoryMediaLibrary,
  InMemoryProjectRepository,
  InMemoryStorage,
  oneChunk,
} from "../testing";
import { makeGenerateSceneVoices } from "../voice/generate-scene-voices";
import { makeEstimateFullAi } from "./estimate-full-ai";
import { makeGetFullAiResult } from "./get-full-ai-result";
import { makeRequestFullAi } from "./request-full-ai";
import { makeRunFullAi } from "./run-full-ai";

// Full AI on one source video (ADR 0020): analyze when needed, cut into a hook, one long main scene and an
// ending, never search media, then fit each video to its voice (ADR 0021). Fake voices last 5 s (+0,3 s pause).

const video: MediaAsset = {
  id: "ast_src",
  kind: "video",
  source: "upload",
  fileName: "cuu-cho.mp4",
  path: "media/ast_src.mp4",
  durationMs: 20_000,
  contentHash: "sha256:src",
  createdAt: "2026-10-26T00:00:00.000Z",
};

const intro: MediaAsset = {
  ...video,
  id: "ast_intro",
  fileName: "intro.mp4",
  path: "media/ast_intro.mp4",
  durationMs: 4000,
  contentHash: "sha256:intro",
};

const request: FullAiRequest = {
  idea: "Kể lại hành trình giải cứu chú chó",
  targetDurationSec: 20,
  rankingMode: "text",
  sourceVideo: { assetId: "ast_src", volume: 0.2 },
  replaceScenes: false,
};

const analysis: ClipAnalysis = {
  model: "old",
  analyzedAt: "2026-10-20T00:00:00.000Z",
  shots: [
    { index: 0, startMs: 0, endMs: 8000, description: "Chó trong mương", tags: [], textOverlay: false },
    { index: 1, startMs: 8000, endMs: 20_000, description: "Chó được bế lên", tags: [], textOverlay: false },
  ],
};

async function setup() {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const probeResult = { kind: "video" as const, durationMs: 20_000, hasAudio: true };
  const probe = new FakeMediaProbe(storage, {
    mp4: probeResult,
    mp3: { kind: "audio", durationMs: 5000, hasAudio: true },
  });
  const clock = new FakeClock("2026-10-26T12:00:00.000Z");
  const queue = new InMemoryJobQueue(clock);
  const ai = new FakeAi();
  const tts = new FakeTts();
  const costGuard = new FakeCostGuard(undefined, clock);
  const library = new InMemoryMediaLibrary();
  const frames = new FakeClipFrames(storage);
  frames.cuts = [5000, 10_000, 15_000];
  const pexels = new FakeMediaSearch("pexels");
  const providers = [pexels];
  let n = 0;
  const newId = (prefix: string) => `${prefix}_${String(++n)}`;
  await repo.save({
    ...createProject({ name: "P", mode: "full_ai" }, { newId: () => "prj_1" }),
    automationSettings: { ...MODE_PRESETS.full_ai },
    assets: [video, intro],
  });
  await storage.write(`projects/prj_1/${video.path}`, oneChunk(new Uint8Array([1, 2, 3])));

  const addUploadToLibrary = makeAddUploadToLibrary({ library, storage, clock, newId });
  const runFullAi = makeRunFullAi({
    repo,
    storage,
    clock,
    ai: () => ai,
    searchMedia: makeSearchMedia({ repo, library, providers }),
    importCandidate: makeImportCandidate({
      repo,
      library,
      providers,
      storage,
      probe,
      remote: new FakeRemoteFiles(),
      clock,
      newId,
    }),
    rankImages: makeResolveRankImages({ library, repo, storage, providers }),
    source: { library, storage, frames, probe, clock, addUploadToLibrary },
    voices: {
      tts,
      generate: makeGenerateSceneVoices({ repo, storage, probe, tts: () => tts, clock, newId }),
      defaults: { modelId: "m1" },
    },
  });
  const deps = { repo, ai, tts, voiceDefaults: { modelId: "m1" }, costGuard, library };
  let jobs = 0;
  return {
    repo,
    library,
    ai,
    pexels,
    addUploadToLibrary,
    probeResult,
    frames,
    estimate: makeEstimateFullAi(deps),
    request: makeRequestFullAi({ ...deps, queue, clock, newId: () => `job_${String(++jobs)}` }),
    getResult: makeGetFullAiResult({ queue, storage }),
    run: makeRunNextRenderJob({
      queue,
      renderProject: () => Promise.reject(new Error("not a render")),
      exportCapcut: () => Promise.reject(new Error("not a render")),
      runFullAi,
      clock,
    }),
  };
}

describe("Full AI on a source video", () => {
  it("uses the real picture duration for analysis and cutting even with old library metadata", async () => {
    const s = await setup();
    const oldVideo = { ...video, durationMs: 62_037 };
    await s.repo.update("prj_1", (project) => ({ ...project, assets: [oldVideo, intro] }));
    const { item } = await s.addUploadToLibrary({ projectId: "prj_1", asset: oldVideo });
    s.probeResult.durationMs = 57_367;
    s.frames.cuts = [55_000, 58_000, 60_000];
    await s.request({ projectId: "prj_1", request });
    expect(await s.run()).toMatchObject({ status: "COMPLETED" });
    expect(s.ai.shotCalls[0]?.input.durationMs).toBe(57_367);
    expect(s.frames.grabbed[0]?.atMs.every((ms) => ms < 57_367)).toBe(true);
    const cut = s.ai.calls.find((call) => call.type === "source_cut");
    expect(cut?.type === "source_cut" && cut.input.durationMs).toBe(57_367);
    expect(cut?.type === "source_cut" && cut.input.shots.at(-1)?.endMs).toBe(57_367);
    const project = await s.repo.get("prj_1");
    expect(project.scenes.length).toBeGreaterThan(0);
    expect(project.scenes.every((scene) => (scene.media?.sourceEndMs ?? Infinity) <= 57_367)).toBe(true);
    expect((await s.library.get(item.id)).durationMs).toBe(62_037);
  });

  it("analyzes the video, then makes hook, one long main scene and ending fitted to their voices", async () => {
    const s = await setup();
    // Longer than the 20 s video: the hook and the ending add to it.
    const full: FullAiRequest = {
      ...request,
      targetDurationSec: 60,
      sourceVideo: {
        assetId: "ast_src",
        volume: 0.2,
        hook: { kind: "asset", assetId: "ast_intro" },
        outro: { kind: "source" },
      },
    };
    const cost = await s.estimate({ projectId: "prj_1", request: full });
    expect(cost.steps).toEqual(["analyze", "cut", "voice"]);
    expect(cost.costs.map((part) => part.step)).toEqual(["analyze", "cut", "voice"]);
    expect(cost.sceneCount).toBe(3);

    const job = await s.request({ projectId: "prj_1", request: full });
    const done = await s.run();
    expect(done).toMatchObject({ id: job.id, status: "COMPLETED" });
    expect(s.ai.calls.map((call) => call.type)).toEqual(["source_cut"]);
    expect(s.pexels.searches).toEqual([]);

    // The upload went to the shared library and got its four shots there.
    const item = await s.library.findBySourceRef(uploadSourceRef("sha256:src"));
    expect(item?.analysis?.shots).toHaveLength(4);
    const cut = s.ai.calls[0];
    expect(cut?.type === "source_cut" && cut.input).toMatchObject({
      idea: request.idea,
      targetDurationSec: 60,
      durationMs: 20_000,
      hook: { kind: "clip", durationMs: 4000 },
      outro: { kind: "source" },
      language: "vi",
    });

    const project = await s.repo.get("prj_1");
    expect(
      project.scenes.map((scene) => [
        scene.media?.assetId,
        scene.media?.sourceStartMs,
        scene.media?.sourceEndMs,
        scene.media?.playbackRate,
        scene.durationMs,
      ]),
    ).toEqual([
      // 4 s of intro for 5,3 s of voice: slowed to the limit.
      ["ast_intro", 0, undefined, 0.8, 5000],
      // All 20 s of the source in one scene: sped up to the limit.
      ["ast_src", 0, 20_000, 1.25, 16_000],
      ["ast_src", 0, 5000, 0.943, 5302],
    ]);
    expect(project.scenes.every((scene) => scene.voiceAssetId !== undefined)).toBe(true);
    expect(project.assets.filter((asset) => asset.kind === "video")).toEqual([video, intro]);

    const result = await s.getResult({ projectId: "prj_1", jobId: job.id });
    expect(result.warnings).toEqual([
      expect.stringContaining("Lời đọc ước tính"),
      expect.stringContaining("Phần chính 1: lời đọc"),
      expect.stringContaining("Cảnh 1: giọng dài hơn video"),
      expect.stringContaining("Cảnh 2: video dài hơn giọng"),
    ]);
  });

  it("reuses an analysis made before and sends the user's script", async () => {
    const s = await setup();
    const { item } = await s.addUploadToLibrary({ projectId: "prj_1", asset: video });
    await s.library.setAnalysis(item.id, analysis);
    const withScript: FullAiRequest = {
      ...request,
      idea: undefined,
      sourceVideo: {
        assetId: "ast_src",
        volume: 0,
        script: { text: "Chú chó nằm dưới mương. Mọi người bế nó lên.", role: "narration" },
      },
    };
    s.ai.sourceCut = {
      title: "Cứu chó",
      main: [{ fromShot: 0, toShot: 1, narration: "Chú chó nằm dưới mương. Mọi người bế nó lên." }],
    };
    expect((await s.estimate({ projectId: "prj_1", request: withScript })).steps).toEqual(["cut", "voice"]);
    await s.request({ projectId: "prj_1", request: withScript });
    expect(await s.run()).toMatchObject({ status: "COMPLETED" });

    const cut = s.ai.calls[0];
    expect(cut?.type === "source_cut" && cut.input.script).toEqual(withScript.sourceVideo?.script);
    const project = await s.repo.get("prj_1");
    expect(project.scenes.map((scene) => [scene.narration, scene.visualPlan?.intent])).toEqual([
      ["Chú chó nằm dưới mương. Mọi người bế nó lên.", "Chó trong mương · Chó được bế lên"],
    ]);
  });

  it("stops when the AI rewrites narration it had to keep, and leaves the scenes alone", async () => {
    const s = await setup();
    const { item } = await s.addUploadToLibrary({ projectId: "prj_1", asset: video });
    await s.library.setAnalysis(item.id, analysis);
    s.ai.sourceCut = { title: "", main: [{ fromShot: 0, toShot: 1, narration: "Một câu khác hẳn." }] };
    await s.request({
      projectId: "prj_1",
      request: {
        ...request,
        sourceVideo: { assetId: "ast_src", volume: 0, script: { text: "Lời gốc.", role: "narration" } },
      },
    });
    const done = await s.run();
    expect(done?.status).toBe("FAILED");
    expect(done?.errorMessage).toContain("Dựng theo video nguồn");
    expect((await s.repo.get("prj_1")).scenes).toEqual([]);
  });

  it("refuses a hook clip that is not in the project", async () => {
    const s = await setup();
    const gone: FullAiRequest = {
      ...request,
      sourceVideo: { assetId: "ast_src", volume: 0, hook: { kind: "asset", assetId: "ast_gone" } },
    };
    await expect(s.estimate({ projectId: "prj_1", request: gone })).rejects.toThrow(
      expect.objectContaining({ code: "INVALID_MEDIA" }),
    );
  });
});
