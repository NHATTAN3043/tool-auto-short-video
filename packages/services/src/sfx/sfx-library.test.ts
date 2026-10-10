import { createProject } from "@studio/domain";
import { describe, expect, it } from "vitest";

import {
  FakeClock,
  FakeMediaProbe,
  InMemoryProjectRepository,
  InMemorySfxLibrary,
  InMemoryStorage,
  oneChunk,
} from "../testing";
import {
  makeImportLibrarySfx,
  makeListLibrarySfx,
  makeReadLibrarySfxFile,
  makeRemoveLibrarySfx,
  makeRenameLibrarySfx,
  makeUseLibrarySfxInProject,
} from "./sfx-library";

const bytes = new Uint8Array([1, 2, 3, 4]);

async function setup() {
  const library = new InMemorySfxLibrary();
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const probe = new FakeMediaProbe(storage);
  const clock = new FakeClock("2026-03-01T00:00:00.000Z");
  let n = 0;
  const newId = (prefix: string) => `${prefix}_${String(++n)}`;
  await repo.save(
    createProject({ name: "P", mode: "manual" }, { newId: () => "prj_1", now: "2026-01-01T00:00:00.000Z" }),
  );
  return {
    library,
    repo,
    storage,
    probe,
    importSfx: makeImportLibrarySfx({ library, storage, probe, clock, newId, maxBytes: 10 }),
    useInProject: makeUseLibrarySfxInProject({ library, repo, storage, clock, newId }),
  };
}

describe("sound effect library", () => {
  it("stores an uploaded audio file and lists it", async () => {
    const s = await setup();
    const item = await s.importSfx({ fileName: "C:\\sfx\\Pop.mp3", data: oneChunk(bytes) });
    expect(item).toEqual({
      id: "lib_1",
      name: "Pop",
      fileName: "Pop.mp3",
      path: "files/lib_1.mp3",
      durationMs: 5000,
      contentHash: expect.stringMatching(/^sha256:/u) as string,
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    expect(s.storage.files.get("library/sfx/files/lib_1.mp3")).toEqual(bytes);
    expect(await makeListLibrarySfx(s)()).toEqual([item]);
  });

  it("rejects non-audio files and cleans up after a failure", async () => {
    const s = await setup();
    await expect(s.importSfx({ fileName: "clip.mp4", data: oneChunk(bytes) })).rejects.toMatchObject({
      code: "INVALID_MEDIA",
    });
    await expect(
      s.importSfx({ fileName: "big.mp3", data: oneChunk(new Uint8Array(11)) }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    s.probe.failProbe = true;
    await expect(s.importSfx({ fileName: "bad.mp3", data: oneChunk(bytes) })).rejects.toMatchObject({
      code: "INVALID_MEDIA",
    });
    expect(s.storage.files.size).toBe(0);
    expect(await s.library.list()).toEqual([]);
  });

  it("renames, serves and removes an effect", async () => {
    const s = await setup();
    const item = await s.importSfx({ fileName: "pop.mp3", data: oneChunk(bytes) });
    expect((await makeRenameLibrarySfx(s)({ id: item.id, name: "Bốp" })).name).toBe("Bốp");

    const file = await makeReadLibrarySfxFile(s)({ id: item.id, range: "bytes=1-2" });
    expect(file).toMatchObject({ status: 206, contentType: "audio/mpeg", start: 1, end: 2, size: 4 });

    await makeRemoveLibrarySfx(s)(item.id);
    expect(s.storage.files.size).toBe(0);
    await expect(s.library.get(item.id)).rejects.toMatchObject({ code: "SFX_NOT_FOUND" });
  });

  it("copies an effect into a project once, as a library audio asset", async () => {
    const s = await setup();
    const item = await s.importSfx({ fileName: "pop.mp3", data: oneChunk(bytes) });

    const first = await s.useInProject({ projectId: "prj_1", sfxId: item.id });
    expect(first.asset).toMatchObject({
      id: "ast_2",
      kind: "audio",
      source: "library",
      fileName: "pop.mp3",
      path: "media/ast_2.mp3",
      durationMs: 5000,
      contentHash: item.contentHash,
    });
    expect(s.storage.files.get("projects/prj_1/media/ast_2.mp3")).toEqual(bytes);
    expect((await s.repo.get("prj_1")).assets).toEqual([first.asset]);

    const again = await s.useInProject({ projectId: "prj_1", sfxId: item.id });
    expect(again.asset.id).toBe("ast_2");

    // Removing it from the library leaves the project's copy alone.
    await makeRemoveLibrarySfx(s)(item.id);
    expect(s.storage.files.has("projects/prj_1/media/ast_2.mp3")).toBe(true);
  });

  it("copies only once when the same effect is picked twice at the same time", async () => {
    const s = await setup();
    const item = await s.importSfx({ fileName: "pop.mp3", data: oneChunk(bytes) });
    const [a, b] = await Promise.all([
      s.useInProject({ projectId: "prj_1", sfxId: item.id }),
      s.useInProject({ projectId: "prj_1", sfxId: item.id }),
    ]);
    expect(a.asset.id).toBe(b.asset.id);
    expect((await s.repo.get("prj_1")).assets).toHaveLength(1);
    expect([...s.storage.files.keys()].filter((key) => key.startsWith("projects/"))).toHaveLength(1);
  });

  it("reports unknown effects and projects", async () => {
    const s = await setup();
    await expect(s.useInProject({ projectId: "prj_1", sfxId: "lib_x" })).rejects.toMatchObject({
      code: "SFX_NOT_FOUND",
    });
    const item = await s.importSfx({ fileName: "pop.mp3", data: oneChunk(bytes) });
    await expect(s.useInProject({ projectId: "prj_x", sfxId: item.id })).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
    });
  });
});
