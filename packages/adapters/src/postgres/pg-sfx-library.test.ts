import type { LibrarySfx } from "@studio/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PgDatabase } from "./database";
import { PgSfxLibrary } from "./pg-sfx-library";
import { createTestDatabase, TEST_DATABASE_URL, truncateAll, type TestDatabase } from "./test-database";

const item = (id: string, createdAt = "2026-01-01T00:00:00.000Z"): LibrarySfx => ({
  id,
  name: `Hiệu ứng ${id}`,
  fileName: `${id}.mp3`,
  path: `files/${id}.mp3`,
  durationMs: 800,
  contentHash: `sha256:${id}`,
  createdAt,
});

describe.skipIf(TEST_DATABASE_URL === undefined)("PgSfxLibrary", () => {
  let testDb: TestDatabase;
  let database: PgDatabase;
  let library: PgSfxLibrary;

  beforeAll(async () => {
    testDb = await createTestDatabase(TEST_DATABASE_URL ?? "");
    database = testDb.connect();
    library = new PgSfxLibrary(database.db);
  });

  afterAll(async () => {
    await testDb.drop();
  });

  beforeEach(async () => {
    await truncateAll(database);
  });

  it("starts empty and persists added items, newest first", async () => {
    expect(await library.list()).toEqual([]);
    await library.add(item("lib_1"));
    await library.add(item("lib_2", "2026-02-01T00:00:00.000Z"));
    expect(await new PgSfxLibrary(database.db).list()).toEqual([
      item("lib_2", "2026-02-01T00:00:00.000Z"),
      item("lib_1"),
    ]);
  });

  it("keeps concurrent adds and refuses a duplicate id", async () => {
    await Promise.all(["lib_1", "lib_2", "lib_3"].map((id) => library.add(item(id))));
    expect(await library.list()).toHaveLength(3);
    await expect(library.add(item("lib_1"))).rejects.toMatchObject({ code: "INVALID_OPERATION" });
  });

  it("keeps an effect without a known duration", async () => {
    const withoutDuration: LibrarySfx = { ...item("lib_1") };
    delete withoutDuration.durationMs;
    await library.add(withoutDuration);
    expect(await library.get("lib_1")).toEqual(withoutDuration);
  });

  it("renames and removes, reporting unknown ids", async () => {
    await library.add(item("lib_1"));
    expect((await library.rename("lib_1", "Bốp")).name).toBe("Bốp");
    expect((await library.get("lib_1")).name).toBe("Bốp");
    await expect(library.rename("lib_1", "  ")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await library.remove("lib_1");
    await expect(library.get("lib_1")).rejects.toMatchObject({ code: "SFX_NOT_FOUND" });
    await expect(library.remove("lib_1")).rejects.toMatchObject({ code: "SFX_NOT_FOUND" });
    await expect(library.rename("lib_1", "x")).rejects.toMatchObject({ code: "SFX_NOT_FOUND" });
  });
});
