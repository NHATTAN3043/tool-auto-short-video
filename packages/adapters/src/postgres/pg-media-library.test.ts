import type { LibraryMedia } from "@studio/domain";
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

  it("sets tags, counts concurrent uses and removes", async () => {
    await library.add(item("lib_1"));
    await library.setTags("lib_1", ["cat"]);
    await Promise.all([library.incrementUsage("lib_1"), library.incrementUsage("lib_1")]);
    expect(await library.get("lib_1")).toMatchObject({ tags: ["cat"], usageCount: 2 });
    await library.remove("lib_1");
    await expect(library.get("lib_1")).rejects.toMatchObject({ code: "LIBRARY_MEDIA_NOT_FOUND" });
  });
});
