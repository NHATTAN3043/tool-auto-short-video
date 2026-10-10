import {
  createProject,
  DomainError,
  sceneVoiceStatus,
  scriptToScenes,
  updateScene,
  type Project,
  type VoiceSettings,
} from "@studio/domain";
import { describe, expect, it } from "vitest";

import type { TtsPort } from "../ports/tts";
import { makeRunNextRenderJob } from "../render/run-next-render-job";
import {
  FakeClock,
  FakeCostGuard,
  FakeMediaProbe,
  FakeTts,
  InMemoryJobQueue,
  InMemoryProjectRepository,
  InMemoryStorage,
} from "../testing";
import { makeEstimateSceneVoices } from "./estimate-scene-voices";
import { makeGenerateSceneVoices } from "./generate-scene-voices";
import { makeListTtsVoices } from "./list-tts-voices";
import { makeRequestSceneVoices } from "./request-scene-voices";

const voice: VoiceSettings = {
  provider: "fake",
  voiceId: "v1",
  modelId: "m1",
  stability: 0.5,
  similarityBoost: 0.75,
  speed: 1,
};

const SCRIPT = "Cảnh một.\n\nCảnh hai.\n\nCảnh ba.\n\nCảnh bốn.\n\nCảnh năm.";

async function setup(extra: Partial<Project> = { voice }) {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const probe = new FakeMediaProbe(storage);
  const tts = new FakeTts();
  const clock = new FakeClock("2026-10-01T00:00:00.000Z");
  const queue = new InMemoryJobQueue(clock);
  const costGuard = new FakeCostGuard(undefined, clock);
  let n = 0;
  const ids = () => `ast_${String(++n)}`;
  let jobs = 0;
  await repo.save({
    ...createProject({ name: "P", mode: "assisted" }, { newId: () => "prj_1" }),
    scenes: scriptToScenes(SCRIPT, {}, { newId: (prefix) => `${prefix}_${String(++n)}` }),
    ...extra,
  });
  const generate = makeGenerateSceneVoices({ repo, storage, probe, tts: () => tts, clock, newId: ids });
  const request = makeRequestSceneVoices({
    repo,
    queue,
    tts,
    costGuard,
    clock,
    newId: () => `job_${String(++jobs)}`,
  });
  const estimate = makeEstimateSceneVoices({ repo, tts, costGuard });
  const sceneIds = async () => (await repo.get("prj_1")).scenes.map((scene) => scene.id);
  return { repo, storage, probe, tts, queue, costGuard, generate, request, estimate, sceneIds };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function filesOf(s: Setup) {
  return new Map([...s.storage.files].map(([key, bytes]) => [key, new TextDecoder().decode(bytes)]));
}

describe("generateSceneVoices", () => {
  it("makes one tts voice per scene with duration and content hash", async () => {
    const s = await setup();
    const ids = await s.sceneIds();
    const progress: number[] = [];
    const result = await s.generate({
      projectId: "prj_1",
      sceneIds: ids,
      onProgress: (p) => progress.push(p),
    });

    expect(result).toEqual({ generated: ids, skipped: [], failed: [] });
    expect(progress).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
    expect(s.tts.calls.map((call) => call.text)).toEqual([
      "Cảnh một.",
      "Cảnh hai.",
      "Cảnh ba.",
      "Cảnh bốn.",
      "Cảnh năm.",
    ]);
    const project = await s.repo.get("prj_1");
    const first = project.assets.find((asset) => asset.id === project.scenes[0]?.voiceAssetId);
    expect(first).toMatchObject({
      kind: "audio",
      source: "tts",
      fileName: "giong-canh-01.mp3",
      durationMs: 5000,
      contentHash: expect.stringMatching(/^tts1:/u) as unknown,
    });
    expect(project.scenes.every((scene) => sceneVoiceStatus(project, scene) === "current")).toBe(true);
  });

  it("regenerates only the scene whose narration changed (M8 acceptance)", async () => {
    const s = await setup();
    const ids = await s.sceneIds();
    await s.generate({ projectId: "prj_1", sceneIds: ids });
    const before = await s.repo.get("prj_1");
    const filesBefore = filesOf(s);

    const fourth = ids[3] ?? "";
    await s.repo.save(updateScene(before, fourth, { narration: "Cảnh bốn đã sửa lời." }));
    s.tts.calls.length = 0;

    const result = await s.generate({ projectId: "prj_1", sceneIds: ids });
    expect(result.generated).toEqual([fourth]);
    expect(result.skipped).toEqual(ids.filter((id) => id !== fourth));
    expect(s.tts.calls.map((call) => call.text)).toEqual(["Cảnh bốn đã sửa lời."]);

    const after = await s.repo.get("prj_1");
    after.scenes.forEach((scene, i) => {
      if (scene.id === fourth) expect(scene.voiceAssetId).not.toBe(before.scenes[i]?.voiceAssetId);
      else expect(scene.voiceAssetId).toBe(before.scenes[i]?.voiceAssetId);
    });
    // Every earlier file is still there, byte for byte; only one file was added.
    for (const [key, content] of filesBefore) expect(filesOf(s).get(key)).toBe(content);
    expect(s.storage.files.size).toBe(filesBefore.size + 1);
    expect(after.assets).toHaveLength(before.assets.length + 1);
  });

  it("regenerates every voice when the voice settings change", async () => {
    const s = await setup();
    const ids = await s.sceneIds();
    await s.generate({ projectId: "prj_1", sceneIds: ids });
    const project = await s.repo.get("prj_1");
    await s.repo.save({ ...project, voice: { ...voice, speed: 1.1 } });
    expect((await s.generate({ projectId: "prj_1", sceneIds: ids })).generated).toEqual(ids);
  });

  it("keeps finished scenes when one fails and cleans up nothing it did not write", async () => {
    const s = await setup();
    const ids = await s.sceneIds();
    s.tts.failFor.add("Cảnh hai.");
    const result = await s.generate({ projectId: "prj_1", sceneIds: ids });
    expect(result.generated).toEqual([ids[0], ids[2], ids[3], ids[4]]);
    expect(result.failed).toEqual([{ sceneId: ids[1], message: "provider failed for Cảnh hai." }]);
    const project = await s.repo.get("prj_1");
    expect(project.scenes[1]?.voiceAssetId).toBeUndefined();
    expect(s.storage.files.size).toBe(4);
  });

  it("removes the written file when it cannot be probed", async () => {
    const s = await setup();
    s.probe.failProbe = true;
    const [first] = await s.sceneIds();
    const result = await s.generate({ projectId: "prj_1", sceneIds: [first ?? ""] });
    expect(result.failed).toHaveLength(1);
    expect(s.storage.files.size).toBe(0);
    expect((await s.repo.get("prj_1")).assets).toEqual([]);
  });

  it("skips deleted and empty scenes", async () => {
    const s = await setup();
    const project = await s.repo.get("prj_1");
    const first = project.scenes[0]?.id ?? "";
    await s.repo.save(updateScene(project, first, { narration: "  " }));
    const result = await s.generate({ projectId: "prj_1", sceneIds: [first, "scn_gone"] });
    expect(result).toEqual({ generated: [], skipped: [first, "scn_gone"], failed: [] });
    expect(s.tts.calls).toEqual([]);
  });

  it("stops at the first blocked scene: the voices made before it are kept", async () => {
    const s = await setup();
    const ids = await s.sceneIds();
    let calls = 0;
    const tts = s.tts;
    const blockedAfterTwo: TtsPort = {
      id: tts.id,
      models: tts.models,
      listVoices: () => tts.listVoices(),
      estimate: (text) => tts.estimate(text),
      synthesize: (text, settings) =>
        ++calls > 2
          ? Promise.reject(new DomainError("BUDGET_EXCEEDED", "Vượt ngân sách 24 giờ"))
          : tts.synthesize(text, settings),
    };
    const generate = makeGenerateSceneVoices({
      repo: s.repo,
      storage: s.storage,
      probe: s.probe,
      tts: () => blockedAfterTwo,
      clock: new FakeClock(),
    });
    const result = await generate({ projectId: "prj_1", sceneIds: ids });
    expect(result.generated).toEqual(ids.slice(0, 2));
    expect(result.failed).toEqual(
      ids.slice(2).map((sceneId) => ({ sceneId, message: "Vượt ngân sách 24 giờ" })),
    );
    // Only the first blocked scene reached the provider.
    expect(calls).toBe(3);
  });

  it("refuses to run without voice settings", async () => {
    const s = await setup({});
    await expect(s.generate({ projectId: "prj_1", sceneIds: await s.sceneIds() })).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
  });
});

describe("estimateSceneVoices", () => {
  it("counts only scenes that need a voice, without calling the provider", async () => {
    const s = await setup();
    const ids = await s.sceneIds();
    await s.generate({ projectId: "prj_1", sceneIds: ids.slice(0, 3) });
    s.tts.calls.length = 0;
    const estimate = await s.estimate({ projectId: "prj_1" });
    expect(estimate.sceneIds).toEqual(ids.slice(3));
    expect(estimate.characters).toBe("Cảnh bốn.".length + "Cảnh năm.".length);
    expect(estimate.credits).toBe(estimate.characters * 0.5);
    expect(estimate.budget).toMatchObject({
      allowed: true,
      planned: { totalUsd: estimate.usd, maxCallUsd: "Cảnh năm.".length * 0.5 * 0.0006 },
    });
    expect(s.tts.calls).toEqual([]);
  });
});

describe("requestSceneVoices", () => {
  it("queues a tts job with the scenes that need a voice", async () => {
    const s = await setup();
    const ids = await s.sceneIds();
    const job = await s.request({ projectId: "prj_1", sceneIds: [ids[1] ?? ""] });
    expect(job).toMatchObject({ id: "job_1", kind: "tts", sceneIds: [ids[1]], status: "QUEUED" });
  });

  it("returns an active job that already covers the scenes, otherwise queues another", async () => {
    const s = await setup();
    const ids = await s.sceneIds();
    const all = await s.request({ projectId: "prj_1" });
    expect(all.sceneIds).toEqual(ids);
    expect((await s.request({ projectId: "prj_1", sceneIds: [ids[2] ?? ""] })).id).toBe(all.id);
    await s.queue.update(all.id, { status: "FAILED" });
    expect((await s.request({ projectId: "prj_1", sceneIds: [ids[2] ?? ""] })).id).toBe("job_2");
  });

  it("refuses a batch that would break a budget, with the reason", async () => {
    const s = await setup();
    s.costGuard.limits = { ...s.costGuard.limits, perProjectUsd: 0.001 };
    await expect(s.request({ projectId: "prj_1" })).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
      message: expect.stringContaining("mỗi dự án") as unknown,
    });
    expect(await s.queue.list()).toEqual([]);
  });

  it("rejects when nothing needs a voice or no voice is chosen", async () => {
    const s = await setup();
    await s.generate({ projectId: "prj_1", sceneIds: await s.sceneIds() });
    await expect(s.request({ projectId: "prj_1" })).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    const bare = await setup({});
    await expect(bare.request({ projectId: "prj_1" })).rejects.toMatchObject({ code: "INVALID_OPERATION" });
  });
});

describe("listTtsVoices", () => {
  it("returns provider, models and voices; maps provider errors to TTS_FAILED", async () => {
    const tts = new FakeTts();
    const list = makeListTtsVoices({ tts });
    expect(await list()).toEqual({ provider: "fake", models: tts.models, voices: tts.voices });
    tts.failList = true;
    await expect(list()).rejects.toMatchObject({ code: "TTS_FAILED" });
  });
});

describe("runNextRenderJob with tts jobs", () => {
  const unused = () => Promise.reject(new Error("not a render"));

  it("generates the job's scene voices and completes without an output file", async () => {
    const s = await setup();
    const clock = new FakeClock("2026-10-01T00:00:00.000Z");
    const job = await s.request({ projectId: "prj_1" });
    const run = makeRunNextRenderJob({
      queue: s.queue,
      renderProject: unused,
      exportCapcut: unused,
      generateSceneVoices: s.generate,
      clock,
    });
    const done = await run();
    expect(done).toMatchObject({ id: job.id, status: "COMPLETED", progress: 1 });
    expect(done?.outputPath).toBeUndefined();
    expect(s.tts.calls).toHaveLength(5);
  });

  it("fails with a summary when a scene fails, keeping the others", async () => {
    const s = await setup();
    s.tts.failFor.add("Cảnh ba.");
    await s.request({ projectId: "prj_1" });
    const run = makeRunNextRenderJob({
      queue: s.queue,
      renderProject: unused,
      exportCapcut: unused,
      generateSceneVoices: s.generate,
      clock: new FakeClock(),
    });
    const done = await run();
    expect(done?.status).toBe("FAILED");
    expect(done?.errorMessage).toContain("1/5");
    const project = await s.repo.get("prj_1");
    expect(project.scenes.filter((scene) => scene.voiceAssetId !== undefined)).toHaveLength(4);
  });

  it("fails clearly when the worker has no TTS provider", async () => {
    const s = await setup();
    await s.request({ projectId: "prj_1" });
    const run = makeRunNextRenderJob({
      queue: s.queue,
      renderProject: unused,
      exportCapcut: unused,
      generateSceneVoices: null,
      clock: new FakeClock(),
    });
    expect((await run())?.errorMessage).toContain("ELEVENLABS_API_KEY");
  });
});
