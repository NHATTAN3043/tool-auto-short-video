import { uploadSourceRef, type ClipAnalysis, type LibraryMedia } from "@studio/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PgDatabase } from "./database";
import { PgMediaLibrary } from "./pg-media-library";
import { createTestDatabase, TEST_DATABASE_URL, truncateAll, type TestDatabase } from "./test-database";

const item = (id: string, createdAt = "2026-01-01T00:00:00.000Z"): LibraryMedia => ({
  id,
  kind: "video",
  fileName: `${id}.mp4`,
  path: `files/${id}.mp4`,
  tags: ["mèo"],
  usageCount: 0,
  source: "pixabay",
  sourceRef: `pixabay:video:${id}`,
  contentHash: `sha256:${id}`,
  createdAt,
});

describe.skipIf(TEST_DATABASE_URL === undefined)("PgMediaLibrary", () => {
  let testDb: TestDatabase;
  let database: PgDatabase;
  let library: PgMediaLibrary;

  beforeAll(async () => {
    testDb = await createTestDatabase(TEST_DATABASE_URL ?? "");
    database = testDb.connect();
    library = new PgMediaLibrary(database.db);
  });

  afterAll(async () => {
    await testDb.drop();
  });

  beforeEach(async () => {
    await truncateAll(database);
  });

  it("adds, lists newest first and finds by source", async () => {
    await library.add(item("lib_1"));
    await library.add(item("lib_2", "2026-02-01T00:00:00.000Z"));
    expect((await library.list()).map((i) => i.id)).toEqual(["lib_2", "lib_1"]);
    expect(await library.findBySourceRef("pixabay:video:lib_1")).toEqual(item("lib_1"));
    await expect(library.add({ ...item("lib_3"), sourceRef: "pixabay:video:lib_1" })).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
  });

  it("keeps an uploaded video with its shot analysis, found by its content hash (ADR 0019)", async () => {
    const upload: LibraryMedia = {
      ...item("lib_up"),
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

    const reanalyzed: ClipAnalysis = {
      shots: [{ index: 0, startMs: 0, endMs: 6000, description: "Mèo", tags: ["cat"], textOverlay: false }],
      model: "claude-opus-5-5",
      analyzedAt: "2026-10-24T00:00:00.000Z",
    };
    expect((await library.setAnalysis("lib_up", reanalyzed)).analysis).toEqual(reanalyzed);
    expect((await library.get("lib_up")).analysis).toEqual(reanalyzed);
    await expect(library.setAnalysis("lib_gone", reanalyzed)).rejects.toMatchObject({
      code: "LIBRARY_MEDIA_NOT_FOUND",
    });
  });

  it("sets tags, counts concurrent uses and removes", async () => {
    await library.add(item("lib_1"));
    await library.setTags("lib_1", ["cat"]);
    await Promise.all([library.incrementUsage("lib_1"), library.incrementUsage("lib_1")]);
    expect(await library.get("lib_1")).toMatchObject({ tags: ["cat"], usageCount: 2 });
    await library.remove("lib_1");
    await expect(library.get("lib_1")).rejects.toMatchObject({ code: "LIBRARY_MEDIA_NOT_FOUND" });
  });
});
