import { addSceneSfx, createProject, type MediaAsset, type Project, type Scene } from "@studio/domain";
import { describe, expect, it } from "vitest";

import {
  FakeArchive,
  FakeClipCutter,
  FakeRenderer,
  InMemoryProjectRepository,
  InMemoryStorage,
} from "../testing";
import { makeExportCapcut } from "./export-capcut";

const NOW = "2026-01-01T00:00:00.000Z";
const audio = (id: string): MediaAsset => ({
  id,
  kind: "audio",
  source: "upload",
  fileName: `${id}.mp3`,
  path: `media/${id}.mp3`,
  durationMs: 1000,
  createdAt: NOW,
});
const scene = (id: string, durationMs: number): Scene => ({
  id,
  narration: `Cảnh ${id}.`,
  durationMs,
  status: "draft",
});

async function setup(change: (project: Project) => Project = (p) => p) {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const renderer = new FakeRenderer();
  const cutter = new FakeClipCutter();
  const archive = new FakeArchive(storage);
  const base: Project = {
    ...createProject({ name: "Mèo ngủ", mode: "manual" }, { newId: () => "prj_1", now: NOW }),
    scenes: [scene("a", 2000), scene("b", 1500)],
  };
  await repo.save(change(base));
  const exportCapcut = makeExportCapcut({ repo, storage, renderer, cutter, archive });
  return { storage, renderer, cutter, archive, exportCapcut };
}

describe("exportCapcut", () => {
  it("packs the video without captions, the SRT, per-scene clips and a guide", async () => {
    const s = await setup();
    const progress: number[] = [];
    const result = await s.exportCapcut({
      projectId: "prj_1",
      outputName: "job_1",
      onProgress: (p) => progress.push(p),
    });

    expect(result).toEqual({ zipPath: "render/job_1.zip", srtPath: "render/job_1.srt" });
    // No voice, music or effects: only the video is rendered.
    expect(s.renderer.requests).toHaveLength(1);
    expect(s.renderer.requests[0]).toMatchObject({
      outputPath: "/memory/projects/prj_1/render/job_1-capcut/video_khong_phu_de.mp4",
      layers: { visuals: true, captions: false, voices: false, music: false, sfx: false },
    });
    expect(s.renderer.requests[0]?.format).toBeUndefined();

    expect(s.cutter.cuts.map((cut) => cut.range)).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 2000, endMs: 3500 },
    ]);
    expect(s.archive.archives[0]?.output).toBe("/memory/projects/prj_1/render/job_1.zip");
    expect(s.archive.archives[0]?.entries.map((entry) => entry.name)).toEqual([
      "video_khong_phu_de.mp4",
      "canh/canh_01.mp4",
      "canh/canh_02.mp4",
      "phu_de.srt",
      "HUONG_DAN.txt",
    ]);

    // Intermediate files are gone; the ZIP and the standalone SRT stay.
    expect([...s.storage.files.keys()].sort()).toEqual([
      "projects/prj_1/render/job_1.srt",
      "projects/prj_1/render/job_1.zip",
    ]);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, i) => i === 0 || value >= (progress[i - 1] ?? 0))).toBe(true);
  });

  it("renders every audio layer that has something to hear as its own WAV", async () => {
    const s = await setup((p) =>
      addSceneSfx(
        {
          ...p,
          assets: [audio("voice"), audio("music"), audio("pop")],
          voiceAssetId: "voice",
          music: { assetId: "music", volume: 0.2 },
        },
        "b",
        { assetId: "pop", offsetMs: 300 },
      ),
    );
    await s.exportCapcut({ projectId: "prj_1", outputName: "job_1" });

    const audioRenders = s.renderer.requests.filter((request) => request.format === "wav");
    expect(audioRenders.map((request) => request.outputPath.split("/").slice(-2).join("/"))).toEqual([
      "audio/giong_doc.wav",
      "audio/nhac_nen.wav",
      "audio/hieu_ung.wav",
    ]);
    expect(audioRenders.map((request) => request.layers)).toEqual([
      { visuals: false, captions: false, voices: true, music: false, sfx: false },
      { visuals: false, captions: false, voices: false, music: true, sfx: false },
      { visuals: false, captions: false, voices: false, music: false, sfx: true },
    ]);
    expect(s.archive.archives[0]?.entries.map((entry) => entry.name)).toContain("audio/hieu_ung.wav");
  });

  it("cleans up and leaves no package when a step fails", async () => {
    const s = await setup();
    s.cutter.failWith = new Error("ffmpeg failed");
    await expect(s.exportCapcut({ projectId: "prj_1", outputName: "job_1" })).rejects.toThrow(
      "ffmpeg failed",
    );
    expect(s.storage.files.size).toBe(0);
    expect(s.archive.archives).toEqual([]);
  });

  it("rejects empty projects and unsafe names", async () => {
    const empty = await setup((p) => ({ ...p, scenes: [] }));
    await expect(empty.exportCapcut({ projectId: "prj_1", outputName: "x" })).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
    const s = await setup();
    await expect(s.exportCapcut({ projectId: "prj_1", outputName: "../x" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});
