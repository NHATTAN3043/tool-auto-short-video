import {
  AI_RANK_MAX_CANDIDATES,
  createProject,
  DomainError,
  newFullAiDraft,
  MODE_PRESETS,
  scriptToScenes,
  type AutomationSettings,
  type FullAiOutline,
  type FullAiRequest,
  type MediaCandidate,
  type Project,
} from "@studio/domain";
import { describe, expect, it } from "vitest";

import { makeResolveRankImages } from "../ai/rank-images";
import { makeImportCandidate } from "../media-search/import-candidate";
import { makeSearchMedia } from "../media-search/search-media";
import { makeRunNextRenderJob } from "../render/run-next-render-job";
import {
  FakeAi,
  FakeClock,
  FakeCostGuard,
  FakeMediaProbe,
  FakeMediaSearch,
  FakeRemoteFiles,
  FakeSkillCatalog,
  FakeTts,
  InMemoryJobQueue,
  InMemoryMediaLibrary,
  InMemoryProjectRepository,
  InMemoryStorage,
} from "../testing";
import { makeGenerateSceneVoices } from "../voice/generate-scene-voices";
import { fullAiDraftKey, makeDeleteFullAiDraft, makeGetFullAiDraft, makeSaveFullAiDraft } from "./draft";
import { makeEstimateFullAi } from "./estimate-full-ai";
import { makeGetFullAiResult, makeGetLatestFullAi } from "./get-full-ai-result";
import { makeRequestFullAi } from "./request-full-ai";
import { makeRunFullAi } from "./run-full-ai";

const request: FullAiRequest = {
  idea: "Mèo đi học",
  targetDurationSec: 30,
  rankingMode: "text",
  replaceScenes: false,
};

const stock = (ref: string, kind: "video" | "image" = "video"): MediaCandidate => ({
  provider: "pexels",
  ref,
  kind,
  width: 1080,
  height: 1920,
  description: `${ref} description`,
  thumbnail: { type: "remote", url: `https://cdn.pexels.test/${ref}.jpg` },
});

async function setup(options: { settings?: AutomationSettings; project?: Partial<Project> } = {}) {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const probe = new FakeMediaProbe(storage);
  const clock = new FakeClock("2026-10-10T12:00:00.000Z");
  const queue = new InMemoryJobQueue(clock);
  const ai = new FakeAi();
  const tts = new FakeTts();
  const costGuard = new FakeCostGuard(undefined, clock);
  const library = new InMemoryMediaLibrary();
  const remote = new FakeRemoteFiles();
  const pexels = new FakeMediaSearch("pexels");
  pexels.results = [stock("v1"), stock("v2"), stock("v3"), stock("i1", "image")];
  const providers = [pexels];
  const skills = new FakeSkillCatalog([
    { id: "viral-hooks", name: "viral-hooks", description: "Hooks", language: "en" },
  ]);
  let n = 0;
  const newId = (prefix: string) => `${prefix}_${String(++n)}`;
  await repo.save({
    ...createProject({ name: "P", mode: "full_ai" }, { newId: () => "prj_1" }),
    automationSettings: options.settings ?? { ...MODE_PRESETS.full_ai },
    ...options.project,
  });

  let aiFor = () => ai;
  const searchMedia = makeSearchMedia({ repo, library, providers });
  const importCandidate = makeImportCandidate({
    repo,
    library,
    providers,
    storage,
    probe,
    remote,
    clock,
    newId,
  });
  const generate = makeGenerateSceneVoices({ repo, storage, probe, tts: () => tts, clock, newId });
  const runFullAi = makeRunFullAi({
    repo,
    storage,
    clock,
    ai: () => aiFor(),
    searchMedia,
    importCandidate,
    rankImages: makeResolveRankImages({ library, repo, storage, providers }),
    skills,
    voices: { tts, generate, defaults: { modelId: "m1" } },
  });
  const deps = { repo, ai, tts, voiceDefaults: { modelId: "m1" }, costGuard, skills };
  let jobs = 0;
  return {
    repo,
    storage,
    queue,
    ai,
    tts,
    costGuard,
    pexels,
    skills,
    setAi: (next: FakeAi) => {
      aiFor = () => next;
    },
    estimate: makeEstimateFullAi(deps),
    request: makeRequestFullAi({ ...deps, queue, clock, newId: () => `job_${String(++jobs)}` }),
    getResult: makeGetFullAiResult({ queue, storage }),
    getLatest: makeGetLatestFullAi({ queue, storage }),
    run: makeRunNextRenderJob({
      queue,
      renderProject: () => Promise.reject(new Error("not a render")),
      exportCapcut: () => Promise.reject(new Error("not a render")),
      runFullAi,
      clock,
    }),
  };
}

describe("Full AI", () => {
  it("estimates every paid step without a paid call, and the budget", async () => {
    const s = await setup();
    const estimate = await s.estimate({ projectId: "prj_1", request });
    expect(estimate.steps).toEqual(["script", "scenes", "media", "rank", "select", "voice"]);
    expect(estimate.costs.map((cost) => cost.step)).toEqual(["script", "scenes", "rank", "voice"]);
    expect(estimate.maxUsd).toBeGreaterThanOrEqual(estimate.expectedUsd);
    expect(estimate.budget.allowed).toBe(true);
    expect(s.ai.calls).toEqual([]);
    expect(s.tts.calls).toEqual([]);
  });

  it("goes from an idea to scenes with ranked media and voices (M11b acceptance)", async () => {
    const s = await setup();
    const job = await s.request({ projectId: "prj_1", request });
    expect(job).toMatchObject({ kind: "full_ai", status: "QUEUED", fullAi: { request } });

    const done = await s.run();
    expect(done).toMatchObject({ id: job.id, status: "COMPLETED", outputPath: `full-ai/${job.id}.json` });
    expect(done?.fullAi?.costUsd).toBeGreaterThan(0);
    expect(s.ai.calls.map((call) => call.type)).toEqual(["script", "scenes", "rank_media"]);

    const project = await s.repo.get("prj_1");
    expect(project.script).toBe("Câu một.\n\nCâu hai.");
    expect(project.scenes.map((scene) => scene.narration)).toEqual(["Câu một.", "Câu hai."]);
    // The fake AI ranks in reverse: the last video found becomes the first choice.
    const sources = project.scenes.map(
      (scene) => project.assets.find((asset) => asset.id === scene.media?.assetId)?.fileName,
    );
    expect(sources).toEqual(["pexels-v3.mp4", "pexels-i1.jpg"]);
    // No voice chosen and none configured: the first voice of the account is used.
    expect(project.voice).toMatchObject({ provider: "fake", voiceId: "v1", modelId: "m1" });
    expect(project.scenes.every((scene) => scene.voiceAssetId !== undefined)).toBe(true);

    const result = await s.getResult({ projectId: "prj_1", jobId: job.id });
    expect(result.scenes[0]?.candidates.map((candidate) => candidate.ref)).toEqual(["v3", "v2", "v1"]);
    expect(result.warnings).toEqual([]);
    expect((await s.getLatest("prj_1"))?.result).toEqual(result);
  });

  it("never picks what the ranking rejects, and leaves a scene empty when nothing fits", async () => {
    const s = await setup();
    s.ai.rejectKeys = ["pexels:video:v3", "pexels:image:i1"];
    const job = await s.request({ projectId: "prj_1", request });
    await s.run();

    const project = await s.repo.get("prj_1");
    const files = project.scenes.map(
      (scene) => project.assets.find((asset) => asset.id === scene.media?.assetId)?.fileName,
    );
    expect(files).toEqual(["pexels-v2.mp4", undefined]);
    const result = await s.getResult({ projectId: "prj_1", jobId: job.id });
    // Rejected files stay last, so "Đổi media" can still offer them.
    expect(result.scenes[0]?.candidates.map((candidate) => candidate.ref)).toEqual(["v2", "v1", "v3"]);
    expect(result.warnings).toEqual(["Cảnh 2: AI thấy không media nào phù hợp, hãy chọn tay"]);
  });

  it("offers the project's uploads first, but keeps places for stock", async () => {
    const s = await setup({
      project: {
        assets: Array.from({ length: 12 }, (_, i) => ({
          id: `ast_up${String(i)}`,
          kind: "video" as const,
          source: "upload" as const,
          fileName: `cat__sofa-${String(i)}.mp4`,
          path: `media/ast_up${String(i)}.mp4`,
          width: 1080,
          height: 1920,
          createdAt: "2026-10-10T00:00:00.000Z",
        })),
      },
    });
    // Every stock video is rejected: the scene falls back to the best upload left.
    s.ai.rejectKeys = ["pexels:video:v1", "pexels:video:v2", "pexels:video:v3"];
    const job = await s.request({ projectId: "prj_1", request });
    await s.run();

    const result = await s.getResult({ projectId: "prj_1", jobId: job.id });
    const providers = result.scenes[0]?.candidates.map((candidate) => candidate.provider) ?? [];
    // Twelve uploads match, yet all three stock videos still get a place; the rest go to uploads.
    expect(providers).toHaveLength(AI_RANK_MAX_CANDIDATES);
    expect(providers.filter((provider) => provider === "pexels")).toHaveLength(3);
    expect(providers.filter((provider) => provider === "project")).toHaveLength(AI_RANK_MAX_CANDIDATES - 3);
    // The fake ranking reverses the list: the last upload offered wins, used as is without a copy.
    const project = await s.repo.get("prj_1");
    expect(project.scenes[0]?.media?.assetId).toBe(`ast_up${String(AI_RANK_MAX_CANDIDATES - 4)}`);
    // Twelve uploads, the stock image of scene 2 and two voices.
    expect(project.assets).toHaveLength(12 + 1 + 2);
  });

  it("skips the steps whose toggle is off and uses the project's script", async () => {
    const s = await setup({
      settings: {
        ...MODE_PRESETS.assisted,
        scenePlanning: false,
        visualKeywords: true,
        voiceGeneration: false,
      },
      project: { script: "Một con mèo.\n\nHai con chó." },
    });
    const job = await s.request({ projectId: "prj_1", request: { ...request, idea: undefined } });
    expect(job.fullAi?.steps).toEqual(["scenes", "visual", "media"]);
    expect((await s.run())?.status).toBe("COMPLETED");
    const project = await s.repo.get("prj_1");
    expect(project.scenes.map((scene) => scene.narration)).toEqual(["Một con mèo.", "Hai con chó."]);
    expect(
      project.scenes.every((scene) => scene.media === undefined && scene.voiceAssetId === undefined),
    ).toBe(true);
    expect(s.ai.calls.map((call) => call.type)).toEqual(["visual"]);
    // Without ranking the search order is kept, for "Đổi media".
    const result = await s.getResult({ projectId: "prj_1", jobId: job.id });
    expect(result.scenes[0]?.candidates.map((candidate) => candidate.ref)).toEqual(["v1", "v2", "v3"]);
  });

  it("stops at a blocked budget and keeps what the earlier steps made", async () => {
    const s = await setup();
    const blocked = new FakeAi();
    blocked.planScenes = () => Promise.reject(new DomainError("BUDGET_EXCEEDED", "Vượt ngân sách 24 giờ"));
    s.setAi(blocked);
    await s.request({ projectId: "prj_1", request });
    const done = await s.run();
    expect(done).toMatchObject({
      status: "FAILED",
      errorMessage: 'Dừng ở bước "Chia cảnh": Vượt ngân sách 24 giờ',
      fullAi: { step: "scenes", costUsd: 0.007 },
    });
    expect((await s.repo.get("prj_1")).script).toBe("Câu một.\n\nCâu hai.");
  });

  it("turns a failing stock provider into a warning", async () => {
    const s = await setup();
    s.pexels.fail = true;
    const job = await s.request({ projectId: "prj_1", request });
    expect((await s.run())?.status).toBe("COMPLETED");
    const result = await s.getResult({ projectId: "prj_1", jobId: job.id });
    expect(result.warnings).toEqual([
      "pexels lỗi khi tìm media: pexels is down",
      "Cảnh 1: không tìm thấy media phù hợp",
      "Cảnh 2: không tìm thấy media phù hợp",
    ]);
  });

  it("turns a voice provider error into a warning and keeps the scenes and media", async () => {
    const s = await setup();
    s.tts.failList = true;
    const job = await s.request({ projectId: "prj_1", request });
    expect((await s.run())?.status).toBe("COMPLETED");
    expect((await s.repo.get("prj_1")).scenes.every((scene) => scene.media !== undefined)).toBe(true);
    const result = await s.getResult({ projectId: "prj_1", jobId: job.id });
    expect(result.warnings).toEqual(["Không tạo được giọng: 401 invalid key"]);
  });

  it("sends stock thumbnails as images in vision mode", async () => {
    const s = await setup();
    await s.request({ projectId: "prj_1", request: { ...request, rankingMode: "vision" } });
    await s.run();
    expect([...(s.ai.rankImages[0]?.values() ?? [])][0]).toEqual({
      type: "url",
      url: "https://cdn.pexels.test/v1.jpg",
    });
  });

  it("refuses to replace scenes without confirmation, over budget, and runs one job per project", async () => {
    const withScenes = await setup({ project: { scenes: scriptToScenes("Có sẵn.") } });
    await expect(withScenes.request({ projectId: "prj_1", request })).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
    const first = await withScenes.request({
      projectId: "prj_1",
      request: { ...request, replaceScenes: true },
    });
    expect(
      (await withScenes.request({ projectId: "prj_1", request: { ...request, replaceScenes: true } })).id,
    ).toBe(first.id);

    const poor = await setup();
    poor.costGuard.limits = { ...poor.costGuard.limits, perProjectUsd: 0.01 };
    await expect(poor.request({ projectId: "prj_1", request })).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
      message: expect.stringContaining("mỗi dự án") as unknown,
    });
  });

  it("sends the chosen skill with the script and scene planning, never with the ranking", async () => {
    const s = await setup();
    const withSkill = { ...request, skillId: "viral-hooks" };
    await s.estimate({ projectId: "prj_1", request: withSkill });
    // script, scenes, rank: the first two carry the skill.
    expect(s.ai.estimateGuidance.map((guidance) => guidance?.id)).toEqual([
      "viral-hooks",
      "viral-hooks",
      undefined,
    ]);

    await s.request({ projectId: "prj_1", request: withSkill });
    await s.run();
    expect(s.ai.calls.map((call) => call.type)).toEqual(["script", "scenes", "rank_media"]);
    expect(s.ai.guidance.map((guidance) => guidance?.id)).toEqual(["viral-hooks", "viral-hooks", undefined]);
    expect(s.ai.calls[0]).toMatchObject({ type: "script", input: { skillId: "viral-hooks" } });
  });

  it("sends the skill with the keyword step when the script is only split", async () => {
    const s = await setup({
      settings: { ...MODE_PRESETS.full_ai, scenePlanning: false, visualKeywords: true },
    });
    await s.request({ projectId: "prj_1", request: { ...request, skillId: "viral-hooks" } });
    await s.run();
    expect(s.ai.calls.map((call) => call.type)).toEqual(["script", "visual", "rank_media"]);
    expect(s.ai.guidance.map((guidance) => guidance?.id)).toEqual(["viral-hooks", "viral-hooks", undefined]);
  });

  it("refuses an unknown skill up front, and runs without one removed since", async () => {
    const s = await setup();
    await expect(
      s.estimate({ projectId: "prj_1", request: { ...request, skillId: "missing" } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const job = await s.request({ projectId: "prj_1", request: { ...request, skillId: "viral-hooks" } });
    s.skills.skills.clear();
    expect(await s.run()).toMatchObject({ status: "COMPLETED" });
    expect(s.ai.guidance.every((guidance) => guidance === undefined)).toBe(true);
    const result = await s.getResult({ projectId: "prj_1", jobId: job.id });
    expect(result.warnings).toEqual(['Không đọc được skill "viral-hooks", đã chạy không dùng skill']);
  });

  it("makes an English video: saves the language, writes and reads English", async () => {
    const s = await setup();
    s.ai.script = { title: "Cats", script: "Did you know that cats sleep for most of the day?" };
    await s.request({ projectId: "prj_1", request: { ...request, language: "en", skillId: "viral-hooks" } });
    expect(await s.run()).toMatchObject({ status: "COMPLETED" });
    const project = await s.repo.get("prj_1");
    expect(project.language).toBe("en");
    expect(s.ai.calls[0]).toMatchObject({ type: "script", input: { language: "en" } });
    expect(s.skills.languages.at(-1)).toBe("en");
    expect(s.tts.calls.length).toBeGreaterThan(0);
    expect(s.tts.calls.every((call) => call.language === "en")).toBe(true);
  });

  it("stops at an English script and leaves the project as it was", async () => {
    const s = await setup();
    s.ai.script = { title: "Cats", script: "Did you know that cats sleep for most of the day?" };
    await s.request({ projectId: "prj_1", request });
    const done = await s.run();
    expect(done).toMatchObject({ status: "FAILED" });
    expect(done?.errorMessage).toContain("không phải tiếng Việt");
    const project = await s.repo.get("prj_1");
    expect(project.script).toBe("");
    expect(project.scenes).toEqual([]);
  });

  it("applies an approved outline word for word and plans only the unplanned scenes", async () => {
    const s = await setup();
    const outline: FullAiOutline = {
      title: "Mèo",
      scenes: [
        {
          narration: "Lời đã duyệt một.",
          visualPlan: { intent: "Mèo", preferredMedia: "video", searchQueries: ["cat"] },
        },
        { narration: "Lời thêm tay." },
      ],
    };
    const withOutline = { ...request, outline };
    const estimate = await s.estimate({ projectId: "prj_1", request: withOutline });
    expect(estimate.steps).toEqual(["scenes", "visual", "media", "rank", "select", "voice"]);
    expect(estimate.costs.map((cost) => cost.step)).toEqual(["visual", "rank", "voice"]);
    expect(estimate.sceneCount).toBe(2);

    await s.storage.write(
      fullAiDraftKey("prj_1"),
      (async function* () {
        await Promise.resolve();
        yield new TextEncoder().encode("{}");
      })(),
    );
    await s.request({ projectId: "prj_1", request: withOutline });
    expect((await s.run())?.status).toBe("COMPLETED");
    expect(s.ai.calls.map((call) => call.type)).toEqual(["visual", "rank_media"]);
    const visual = s.ai.calls[0];
    expect(visual?.type === "visual" ? visual.input.scenes.map((scene) => scene.narration) : []).toEqual([
      "Lời thêm tay.",
    ]);
    const project = await s.repo.get("prj_1");
    expect(project.script).toBe("Lời đã duyệt một.\n\nLời thêm tay.");
    expect(project.scenes.map((scene) => scene.visualPlan?.intent)).toEqual(["Mèo", "Lời thêm tay."]);
    expect(project.mediaRankingMode).toBe("text");
    // The draft became this run.
    expect(await s.storage.exists(fullAiDraftKey("prj_1"))).toBe(false);
  });
});

describe("Full AI draft", () => {
  it("saves, reads and deletes the draft apart from the project", async () => {
    const s = await setup();
    const clock = new FakeClock("2026-10-20T08:00:00.000Z");
    const get = makeGetFullAiDraft({ repo: s.repo, storage: s.storage });
    const save = makeSaveFullAiDraft({ repo: s.repo, storage: s.storage, clock });
    const remove = makeDeleteFullAiDraft({ storage: s.storage });

    expect(await get("prj_1")).toBeNull();
    const draft = { ...newFullAiDraft({ now: "2020-01-01T00:00:00.000Z" }), idea: "Mèo" };
    const saved = await save({ projectId: "prj_1", draft });
    expect(saved).toEqual({ ...draft, updatedAt: "2026-10-20T08:00:00.000Z" });
    expect(await get("prj_1")).toEqual(saved);
    expect((await s.repo.get("prj_1")).script).toBe("");

    await remove("prj_1");
    expect(await get("prj_1")).toBeNull();
  });

  it("starts over from a broken file and refuses an unknown project", async () => {
    const s = await setup();
    const get = makeGetFullAiDraft({ repo: s.repo, storage: s.storage });
    await s.storage.write(
      fullAiDraftKey("prj_1"),
      (async function* () {
        await Promise.resolve();
        yield new TextEncoder().encode("not json");
      })(),
    );
    expect(await get("prj_1")).toBeNull();
    await expect(get("prj_missing")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});
