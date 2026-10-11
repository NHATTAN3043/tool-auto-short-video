import { createProject, scriptToScenes, type MediaAsset, type Project } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { makeRunNextRenderJob } from "../render/run-next-render-job";
import {
  FakeAudioNormalizer,
  FakeClock,
  FakeMediaProbe,
  InMemoryJobQueue,
  InMemoryProjectRepository,
  InMemoryStorage,
} from "../testing";
import { makeNormalizeSceneVoices, makeRequestVoiceLoudness } from "./normalize-scene-voices";

const NOW = "2026-10-01T00:00:00.000Z";

const audio = (id: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id,
  kind: "audio",
  source: "tts",
  fileName: `giong-${id}.mp3`,
  path: `media/${id}.mp3`,
  contentHash: `tts1:${id}`,
  createdAt: NOW,
  ...extra,
});

async function setup() {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const probe = new FakeMediaProbe(storage);
  const normalizer = new FakeAudioNormalizer(storage);
  const clock = new FakeClock(NOW);
  const queue = new InMemoryJobQueue(clock);
  let n = 0;
  const scenes = scriptToScenes("Một.\n\nHai.\n\nBa.\n\nBốn.", {}, { newId: (p) => `${p}_${String(++n)}` });
  const project: Project = {
    ...createProject({ name: "P", mode: "full_ai" }, { newId: () => "prj_1" }),
    scenes: scenes.map((scene, i) => {
      const voiceAssetId = ["a_raw", "a_done", "a_up", undefined][i];
      return voiceAssetId ? { ...scene, voiceAssetId } : scene;
    }),
    assets: [
      audio("a_raw"),
      audio("a_done", { loudnessNormalized: true }),
      audio("a_up", { source: "upload" }),
    ],
  };
  await repo.save(project);
  for (const asset of project.assets) {
    await storage.write(`projects/prj_1/${asset.path}`, oneChunk(`voice:${asset.id}`));
  }
  let ids = 0;
  const normalize = makeNormalizeSceneVoices({
    repo,
    storage,
    probe,
    normalizer,
    clock,
    newId: () => `ast_n${String(++ids)}`,
  });
  const request = makeRequestVoiceLoudness({ repo, queue, clock, newId: () => "job_1" });
  const sceneIds = project.scenes.map((scene) => scene.id);
  return { repo, storage, normalizer, queue, normalize, request, sceneIds };
}

async function* oneChunk(text: string): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield new TextEncoder().encode(text);
}

describe("normalizeSceneVoices", () => {
  it("balances only AI voices not yet balanced, as a new file that still matches the narration", async () => {
    const s = await setup();
    const result = await s.normalize({ projectId: "prj_1", sceneIds: s.sceneIds });
    expect(result).toEqual({ generated: [s.sceneIds[0]], skipped: s.sceneIds.slice(1), failed: [] });

    const project = await s.repo.get("prj_1");
    expect(project.scenes[0]?.voiceAssetId).toBe("ast_n1");
    expect(project.assets.find((asset) => asset.id === "ast_n1")).toMatchObject({
      source: "tts",
      fileName: "giong-a_raw-can-bang.mp3",
      contentHash: "tts1:a_raw",
      loudnessNormalized: true,
      durationMs: 5000,
    });
    // The old take is still there, byte for byte, and the uploaded file was never read.
    expect(new TextDecoder().decode(s.storage.files.get("projects/prj_1/media/a_raw.mp3"))).toBe(
      "voice:a_raw",
    );
    expect(s.normalizer.runs.map((run) => run.input)).toEqual(["/memory/projects/prj_1/media/a_raw.mp3"]);
  });

  it("leaves a scene alone when its voice changed while the job ran", async () => {
    const s = await setup();
    const first = s.sceneIds[0] ?? "";
    const original = s.repo.update.bind(s.repo);
    // The user picks another file between the read and the save.
    s.repo.update = async (id, change) => {
      await original(id, (stored) => ({
        ...stored,
        scenes: stored.scenes.map((scene) =>
          scene.id === first ? { ...scene, voiceAssetId: "a_up" } : scene,
        ),
      }));
      return original(id, change);
    };
    const result = await s.normalize({ projectId: "prj_1", sceneIds: [first] });
    expect(result.skipped).toEqual([first]);
    expect((await s.repo.get("prj_1")).scenes[0]?.voiceAssetId).toBe("a_up");
    expect(s.storage.files.has("projects/prj_1/media/ast_n1.mp3")).toBe(false);
  });

  it("reports a failed scene without touching its voice", async () => {
    const s = await setup();
    s.normalizer.failWith = new Error("ffmpeg failed");
    const result = await s.normalize({ projectId: "prj_1", sceneIds: s.sceneIds });
    expect(result.failed).toEqual([{ sceneId: s.sceneIds[0], message: "ffmpeg failed" }]);
    expect((await s.repo.get("prj_1")).scenes[0]?.voiceAssetId).toBe("a_raw");
  });
});

describe("requestVoiceLoudness", () => {
  it("queues a free normalize-only tts job for the unbalanced AI voices, once", async () => {
    const s = await setup();
    const job = await s.request({ projectId: "prj_1" });
    expect(job).toMatchObject({ kind: "tts", sceneIds: [s.sceneIds[0]], voice: { normalizeOnly: true } });
    expect((await s.request({ projectId: "prj_1" })).id).toBe(job.id);
  });

  it("refuses when every AI voice is balanced", async () => {
    const s = await setup();
    await s.normalize({ projectId: "prj_1", sceneIds: s.sceneIds });
    await expect(s.request({ projectId: "prj_1" })).rejects.toMatchObject({ code: "INVALID_OPERATION" });
  });

  it("runs in the worker without a TTS provider", async () => {
    const s = await setup();
    await s.request({ projectId: "prj_1" });
    const unused = () => Promise.reject(new Error("not a render"));
    const run = makeRunNextRenderJob({
      queue: s.queue,
      renderProject: unused,
      exportCapcut: unused,
      generateSceneVoices: null,
      normalizeSceneVoices: s.normalize,
      clock: new FakeClock(NOW),
    });
    expect(await run()).toMatchObject({ status: "COMPLETED", progress: 1 });
    expect((await s.repo.get("prj_1")).scenes[0]?.voiceAssetId).toBe("ast_n1");
  });
});
