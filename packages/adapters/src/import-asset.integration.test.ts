import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createProject } from "@studio/domain";
import { makeImportAsset } from "@studio/services";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FfmpegMediaProbe } from "./ffmpeg/ffmpeg-media-probe";
import {
  ffmpegPath,
  ffprobePath,
  hasFfmpeg,
  makeImage,
  makeMp3,
  makeRotatedVideo,
  makeVideo,
  sha256File,
} from "./ffmpeg/test-media";
import { JsonProjectRepository } from "./repository-json/json-project-repository";
import { LocalStorage } from "./storage-local/local-storage";

// The M2 acceptance test: real files through every adapter, and the original stays byte-identical.
describe.skipIf(!hasFfmpeg)("importAsset with real adapters", () => {
  let sourceDir = "";
  let storageDir = "";
  const sources = { video: "", portrait: "", image: "", mp3: "" };

  beforeAll(() => {
    sourceDir = mkdtempSync(path.join(tmpdir(), "studio-src-"));
    storageDir = mkdtempSync(path.join(tmpdir(), "studio-root-"));
    sources.video = makeVideo(sourceDir);
    sources.portrait = makeRotatedVideo(sourceDir);
    sources.image = makeImage(sourceDir);
    sources.mp3 = makeMp3(sourceDir);
  }, 60_000);

  afterAll(() => {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("imports video, portrait video, image and audio with correct metadata", async () => {
    const repo = new JsonProjectRepository(storageDir);
    const storage = new LocalStorage(storageDir);
    const importAsset = makeImportAsset({
      repo,
      storage,
      probe: new FfmpegMediaProbe({ ffmpegPath, ffprobePath }),
      clock: { now: () => new Date().toISOString() },
    });
    const project = await repo.save(createProject({ name: "Tích hợp", mode: "manual" }));
    const hashesBefore = Object.fromEntries(
      Object.entries(sources).map(([k, file]) => [k, sha256File(file)]),
    );

    const imported = {
      video: await importAsset({
        projectId: project.id,
        fileName: "Cảnh 1.mp4",
        data: createReadStream(sources.video),
      }),
      portrait: await importAsset({
        projectId: project.id,
        fileName: "phone.MP4",
        data: createReadStream(sources.portrait),
      }),
      image: await importAsset({
        projectId: project.id,
        fileName: "ảnh.png",
        data: createReadStream(sources.image),
      }),
      mp3: await importAsset({
        projectId: project.id,
        fileName: "voice.mp3",
        data: createReadStream(sources.mp3),
      }),
    };

    expect(imported.video.asset).toMatchObject({
      kind: "video",
      width: 1280,
      height: 720,
      fps: 30,
      hasAudio: true,
    });
    expect(imported.portrait.asset).toMatchObject({ kind: "video", width: 720, height: 1280 });
    expect(imported.image.asset).toMatchObject({ kind: "image", width: 640, height: 480 });
    expect(imported.mp3.asset).toMatchObject({ kind: "audio" });
    expect(imported.mp3.asset.thumbnailPath).toBeUndefined();

    const projectDir = path.join(storageDir, "projects", project.id);
    for (const [key, { asset }] of Object.entries(imported)) {
      const source = sources[key as keyof typeof sources];
      const stored = path.join(projectDir, asset.path);
      // Originals untouched, stored copies byte-identical, hash recorded on the asset.
      expect(sha256File(source)).toBe(hashesBefore[key]);
      expect(sha256File(stored)).toBe(hashesBefore[key]);
      expect(asset.contentHash).toBe(`sha256:${String(hashesBefore[key])}`);
      if (asset.thumbnailPath)
        expect(statSync(path.join(projectDir, asset.thumbnailPath)).size).toBeGreaterThan(0);
    }

    const reloaded = await new JsonProjectRepository(storageDir).get(project.id);
    expect(reloaded.assets.map((a) => a.fileName)).toEqual([
      "Cảnh 1.mp4",
      "phone.MP4",
      "ảnh.png",
      "voice.mp3",
    ]);
    expect(JSON.parse(readFileSync(path.join(projectDir, "project.json"), "utf8"))).toEqual(reloaded);
  }, 60_000);
});
