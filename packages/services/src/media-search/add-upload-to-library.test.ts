import { createProject, uploadSourceRef, type LibraryMedia } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { makeImportAsset } from "../media/import-asset";
import {
  FakeClock,
  FakeMediaProbe,
  InMemoryMediaLibrary,
  InMemoryProjectRepository,
  InMemoryStorage,
  oneChunk,
} from "../testing";
import { makeAddUploadToLibrary } from "./add-upload-to-library";

const video = new Uint8Array([1, 2, 3, 4]);
const otherVideo = new Uint8Array([9, 9, 9]);

/** A library whose `add` fails, as a full disk or a lost database would. */
class FailingLibrary extends InMemoryMediaLibrary {
  override add(): Promise<LibraryMedia> {
    return Promise.reject(new Error("database is gone"));
  }
}

async function setup(library = new InMemoryMediaLibrary()) {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const probe = new FakeMediaProbe(storage);
  const clock = new FakeClock("2026-03-01T00:00:00.000Z");
  let assets = 0;
  let items = 0;
  const addToLibrary = makeAddUploadToLibrary({
    library,
    storage,
    clock,
    newId: () => `lib_${String(++items)}`,
  });
  const importAsset = makeImportAsset({
    repo,
    storage,
    probe,
    clock,
    newId: () => `ast_${String(++assets)}`,
    addToLibrary,
  });
  for (const id of ["prj_1", "prj_2"]) {
    await repo.save(
      createProject({ name: id, mode: "manual" }, { newId: () => id, now: "2026-01-01T00:00:00.000Z" }),
    );
  }
  const upload = (projectId: string, fileName: string, data = video, addToLibrary?: boolean) =>
    importAsset({
      projectId,
      fileName,
      data: oneChunk(data),
      ...(addToLibrary !== undefined && { addToLibrary }),
    });
  return { repo, storage, library, upload, addToLibrary };
}

const libraryFiles = (storage: InMemoryStorage) =>
  [...storage.files.keys()].filter((key) => key.startsWith("library/media/")).sort();

describe("uploading a video copies it to the shared library", () => {
  it("adds an `upload` item with the file, its thumbnail and the tags of its name", async () => {
    const s = await setup();
    const { asset, library } = await s.upload("prj_1", "cat-sleeping__sofa.mp4");

    expect(library).toEqual({ itemId: "lib_1", created: true });
    const item = await s.library.get("lib_1");
    expect(item).toEqual({
      id: "lib_1",
      kind: "video",
      fileName: "cat-sleeping__sofa.mp4",
      path: "files/lib_1.mp4",
      thumbnailPath: "thumbnails/lib_1.jpg",
      durationMs: 12_000,
      width: 1920,
      height: 1080,
      hasAudio: true,
      tags: ["cat sleeping", "sofa"],
      usageCount: 0,
      source: "upload",
      sourceRef: uploadSourceRef(asset.contentHash ?? ""),
      contentHash: asset.contentHash,
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    expect(s.storage.files.get("library/media/files/lib_1.mp4")).toEqual(video);
    expect(libraryFiles(s.storage)).toEqual([
      "library/media/files/lib_1.mp4",
      "library/media/thumbnails/lib_1.jpg",
    ]);
    // The project keeps its own copy, untouched.
    expect(s.storage.files.get("projects/prj_1/media/ast_1.mp4")).toEqual(video);
  });

  it("stores the same file once, whichever project uploads it again", async () => {
    const s = await setup();
    await s.upload("prj_1", "a.mp4");
    const again = await s.upload("prj_2", "renamed.mp4");
    const other = await s.upload("prj_2", "b.mp4", otherVideo);

    expect(again.library).toEqual({ itemId: "lib_1", created: false });
    expect(other.library).toEqual({ itemId: "lib_2", created: true });
    expect((await s.library.list()).map((item) => item.id).sort()).toEqual(["lib_1", "lib_2"]);
    expect(libraryFiles(s.storage).filter((key) => key.includes("/files/"))).toHaveLength(2);
  });

  it("copies once when the same file is uploaded twice at the same time", async () => {
    const s = await setup();
    const [first, second] = await Promise.all([s.upload("prj_1", "a.mp4"), s.upload("prj_2", "a.mp4")]);
    const results = [first.library, second.library];
    expect(results).toContainEqual({ itemId: "lib_1", created: true });
    expect(results).toContainEqual({ itemId: "lib_1", created: false });
    expect(await s.library.list()).toHaveLength(1);
  });

  it("keeps images, audio and videos the user opted out of in the project only", async () => {
    const s = await setup();
    const image = await s.upload("prj_1", "logo.png");
    const audio = await s.upload("prj_1", "voice.mp3");
    const optedOut = await s.upload("prj_1", "private.mp4", video, false);

    for (const result of [image, audio, optedOut]) expect(result.library).toBeUndefined();
    expect(await s.library.list()).toEqual([]);
    expect(libraryFiles(s.storage)).toEqual([]);
  });

  it("still finishes the upload when the library copy fails, and leaves no file behind in the library", async () => {
    const s = await setup(new FailingLibrary());
    const { asset, library } = await s.upload("prj_1", "a.mp4");

    expect(library).toEqual({ error: "database is gone" });
    expect((await s.repo.get("prj_1")).assets).toEqual([asset]);
    expect(s.storage.files.get("projects/prj_1/media/ast_1.mp4")).toEqual(video);
    expect(libraryFiles(s.storage)).toEqual([]);
  });

  it("refuses a file that does not belong in the library", async () => {
    const s = await setup();
    const { asset } = await s.upload("prj_1", "logo.png");
    await expect(s.addToLibrary({ projectId: "prj_1", asset })).rejects.toThrow(/cannot go to the library/u);
  });
});
