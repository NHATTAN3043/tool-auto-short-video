import { createProject } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { FakeClock, FakeMediaProbe, InMemoryProjectRepository, InMemoryStorage, oneChunk } from "../testing";
import { makeImportAsset } from "./import-asset";

const bytes = new Uint8Array([1, 2, 3, 4]);

async function setup() {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const probe = new FakeMediaProbe(storage);
  const clock = new FakeClock("2026-03-01T00:00:00.000Z");
  let n = 0;
  const importAsset = makeImportAsset({ repo, storage, probe, clock, newId: () => `ast_${String(++n)}` });
  await repo.save(
    createProject({ name: "P", mode: "manual" }, { newId: () => "prj_1", now: "2026-01-01T00:00:00.000Z" }),
  );
  return { repo, storage, probe, importAsset };
}

describe("importAsset", () => {
  it("stores the file untouched, probes it, makes a thumbnail and adds the asset", async () => {
    const s = await setup();
    const { project, asset } = await s.importAsset({
      projectId: "prj_1",
      fileName: "Clip.MP4",
      data: oneChunk(bytes),
    });

    expect(asset).toEqual({
      id: "ast_1",
      kind: "video",
      source: "upload",
      fileName: "Clip.MP4",
      path: "media/ast_1.mp4",
      thumbnailPath: "thumbnails/ast_1.jpg",
      durationMs: 12_000,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      contentHash: expect.stringMatching(/^sha256:/u) as string,
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    expect(s.storage.files.get("projects/prj_1/media/ast_1.mp4")).toEqual(bytes);
    expect(s.probe.thumbnails[0]?.options).toEqual({ atMs: 1000, width: 360 });
    expect(project.assets).toEqual([asset]);
    expect(project.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect((await s.repo.get("prj_1")).assets).toEqual([asset]);
  });

  it("keeps only the fields that make sense for images and audio", async () => {
    const s = await setup();
    const image = await s.importAsset({ projectId: "prj_1", fileName: "a.png", data: oneChunk(bytes) });
    const audio = await s.importAsset({ projectId: "prj_1", fileName: "voice.mp3", data: oneChunk(bytes) });
    expect(image.asset).toMatchObject({
      kind: "image",
      width: 800,
      height: 600,
      thumbnailPath: "thumbnails/ast_1.jpg",
    });
    expect(image.asset).not.toHaveProperty("durationMs");
    expect(image.asset).not.toHaveProperty("hasAudio");
    expect(audio.asset).toMatchObject({ kind: "audio", durationMs: 5000 });
    expect(audio.asset).not.toHaveProperty("thumbnailPath");
    expect(audio.asset).not.toHaveProperty("width");
    expect(s.probe.thumbnails).toHaveLength(1);
  });

  it("strips directories from the display name and never uses it as a path", async () => {
    const s = await setup();
    const { asset } = await s.importAsset({
      projectId: "prj_1",
      fileName: "..\\..\\evil/../secret.png",
      data: oneChunk(bytes),
    });
    expect(asset.fileName).toBe("secret.png");
    expect(asset.path).toBe("media/ast_1.png");
  });

  it("keeps both assets when two uploads run concurrently", async () => {
    const s = await setup();
    await Promise.all([
      s.importAsset({ projectId: "prj_1", fileName: "a.mp4", data: oneChunk(bytes) }),
      s.importAsset({ projectId: "prj_1", fileName: "b.mp4", data: oneChunk(bytes) }),
    ]);
    expect((await s.repo.get("prj_1")).assets.map((a) => a.fileName).sort()).toEqual(["a.mp4", "b.mp4"]);
  });

  it("still imports when the thumbnail fails", async () => {
    const s = await setup();
    s.probe.failThumbnail = true;
    const { asset } = await s.importAsset({ projectId: "prj_1", fileName: "a.mp4", data: oneChunk(bytes) });
    expect(asset.thumbnailPath).toBeUndefined();
  });

  it("rejects unsupported types before writing anything", async () => {
    const s = await setup();
    await expect(
      s.importAsset({ projectId: "prj_1", fileName: "virus.exe", data: oneChunk(bytes) }),
    ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
    expect(s.storage.files.size).toBe(0);
  });

  it("rejects an unknown project before writing anything", async () => {
    const s = await setup();
    await expect(
      s.importAsset({ projectId: "prj_x", fileName: "a.mp4", data: oneChunk(bytes) }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect(s.storage.files.size).toBe(0);
  });

  it.each([
    ["an unreadable file", (s: Awaited<ReturnType<typeof setup>>) => (s.probe.failProbe = true), bytes],
    ["an empty file", () => undefined, new Uint8Array()],
  ])("removes the stored file for %s", async (_label, arrange, data) => {
    const s = await setup();
    arrange(s);
    await expect(
      s.importAsset({ projectId: "prj_1", fileName: "a.mp4", data: oneChunk(data) }),
    ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
    expect(s.storage.files.size).toBe(0);
    expect((await s.repo.get("prj_1")).assets).toEqual([]);
  });

  it("rejects a file whose content does not match its extension", async () => {
    const repo = new InMemoryProjectRepository();
    const storage = new InMemoryStorage();
    const probe = new FakeMediaProbe(storage, { mp4: { kind: "audio", durationMs: 1000, hasAudio: true } });
    await repo.save(createProject({ name: "P", mode: "manual" }, { newId: () => "prj_1" }));
    const importAsset = makeImportAsset({ repo, storage, probe, clock: new FakeClock() });
    await expect(
      importAsset({ projectId: "prj_1", fileName: "a.mp4", data: oneChunk(bytes) }),
    ).rejects.toMatchObject({
      code: "INVALID_MEDIA",
    });
    expect(storage.files.size).toBe(0);
  });

  it("stops a file over the size limit and keeps nothing", async () => {
    const repo = new InMemoryProjectRepository();
    const storage = new InMemoryStorage();
    const probe = new FakeMediaProbe(storage);
    await repo.save(createProject({ name: "P", mode: "manual" }, { newId: () => "prj_1" }));
    const importAsset = makeImportAsset({ repo, storage, probe, clock: new FakeClock(), maxBytes: 4 });
    async function* twoChunks() {
      yield* oneChunk(bytes);
      yield* oneChunk(new Uint8Array([5]));
    }
    await expect(
      importAsset({ projectId: "prj_1", fileName: "a.mp4", data: twoChunks() }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(storage.files.size).toBe(0);
    expect((await repo.get("prj_1")).assets).toEqual([]);

    const atLimit = await importAsset({ projectId: "prj_1", fileName: "a.mp4", data: oneChunk(bytes) });
    expect(atLimit.asset.kind).toBe("video");
  });
});
