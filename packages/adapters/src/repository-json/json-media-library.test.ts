import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { uploadSourceRef, type LibraryMedia } from "@studio/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonMediaLibrary } from "./json-media-library";

const libraryItem = (id: string, createdAt = "2026-01-01T00:00:00.000Z"): LibraryMedia => ({
  id,
  kind: "video",
  fileName: `${id}.mp4`,
  path: `files/${id}.mp4`,
  width: 1080,
  height: 1920,
  durationMs: 8000,
  tags: ["mèo"],
  usageCount: 0,
  source: "pexels",
  sourceRef: `pexels:video:${id}`,
  contentHash: `sha256:${id}`,
  createdAt,
});

describe("JsonMediaLibrary", () => {
  let dir = "";
  let library: JsonMediaLibrary;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-media-lib-"));
    library = new JsonMediaLibrary(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds, lists newest first, finds by source and survives a new instance", async () => {
    expect(await library.list()).toEqual([]);
    await library.add(libraryItem("lib_1"));
    await library.add(libraryItem("lib_2", "2026-02-01T00:00:00.000Z"));
    const reopened = new JsonMediaLibrary(dir);
    expect((await reopened.list()).map((item) => item.id)).toEqual(["lib_2", "lib_1"]);
    expect((await reopened.findBySourceRef("pexels:video:lib_1"))?.id).toBe("lib_1");
    expect(await reopened.findBySourceRef("pexels:video:nope")).toBeNull();
  });

  it("rejects a second item for the same stock file", async () => {
    await library.add(libraryItem("lib_1"));
    await expect(
      library.add({ ...libraryItem("lib_9"), sourceRef: "pexels:video:lib_1" }),
    ).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
  });

  it("keeps an uploaded video with its shot analysis, found by its content hash (ADR 0019)", async () => {
    const upload: LibraryMedia = {
      ...libraryItem("lib_up"),
      source: "upload",
      sourceRef: uploadSourceRef("sha256:lib_up"),
      analysis: {
        shots: [
          { index: 0, startMs: 0, endMs: 2500, description: "Mèo ngủ", tags: ["cat"], textOverlay: false },
          {
            index: 1,
            startMs: 2500,
            endMs: 6000,
            description: "Logo kênh",
            tags: ["logo"],
            textOverlay: true,
            thumbnailPath: "shots/lib_up/001.jpg",
          },
        ],
        model: "claude-sonnet-5-5",
        analyzedAt: "2026-10-23T00:00:00.000Z",
      },
    };
    await library.add(upload);
    expect(await library.findBySourceRef("upload:sha256:lib_up")).toEqual(upload);
    expect(await library.get("lib_up")).toEqual(upload);
  });

  it("sets tags, counts usage under concurrency and removes", async () => {
    await library.add(libraryItem("lib_1"));
    expect((await library.setTags("lib_1", ["cat", "小猫"])).tags).toEqual(["cat", "小猫"]);
    await Promise.all([library.incrementUsage("lib_1"), library.incrementUsage("lib_1")]);
    expect((await library.get("lib_1")).usageCount).toBe(2);
    await library.remove("lib_1");
    await expect(library.get("lib_1")).rejects.toMatchObject({ code: "LIBRARY_MEDIA_NOT_FOUND" });
    await expect(library.remove("lib_1")).rejects.toMatchObject({ code: "LIBRARY_MEDIA_NOT_FOUND" });
  });
});
