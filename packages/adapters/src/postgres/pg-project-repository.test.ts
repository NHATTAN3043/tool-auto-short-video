import { createProject, type Project } from "@studio/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PgDatabase } from "./database";
import { PgProjectRepository } from "./pg-project-repository";
import { projects } from "./schema";
import { createTestDatabase, TEST_DATABASE_URL, truncateAll, type TestDatabase } from "./test-database";

const make = (id: string, updatedAt = "2026-01-01T00:00:00.000Z"): Project => ({
  ...createProject(
    { name: `Dự án ${id}`, mode: "manual" },
    { newId: () => id, now: "2026-01-01T00:00:00.000Z" },
  ),
  updatedAt,
});

describe.skipIf(TEST_DATABASE_URL === undefined)("PgProjectRepository", () => {
  let testDb: TestDatabase;
  let database: PgDatabase;
  let repo: PgProjectRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase(TEST_DATABASE_URL ?? "");
    database = testDb.connect();
    repo = new PgProjectRepository(database.db);
  });

  afterAll(async () => {
    await testDb.drop();
  });

  beforeEach(async () => {
    await truncateAll(database);
  });

  it("saves a project and reads it back, replacing it on the next save", async () => {
    const project = make("prj_a");
    expect(await repo.save(project)).toEqual(project);
    expect(await repo.get("prj_a")).toEqual(project);
    const renamed = { ...project, name: "Đổi tên", updatedAt: "2026-03-01T00:00:00.000Z" };
    await repo.save(renamed);
    expect(await repo.get("prj_a")).toEqual(renamed);
  });

  it("throws PROJECT_NOT_FOUND for missing or malformed ids", async () => {
    await expect(repo.get("prj_missing")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(repo.get("../../etc")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(repo.save({ ...make("prj_a"), id: "prj_../x" })).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
    });
  });

  it("runs the migration on read", async () => {
    await database.db.insert(projects).values({
      id: "prj_old",
      name: "Cũ",
      mode: "manual",
      sceneCount: 0,
      schemaVersion: 99,
      data: { ...make("prj_old"), schemaVersion: 99 },
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await expect(repo.get("prj_old")).rejects.toMatchObject({ code: "UNSUPPORTED_SCHEMA_VERSION" });
  });

  it("refuses to write an invalid project", async () => {
    await expect(repo.save({ ...make("prj_a"), fps: 60 } as unknown as Project)).rejects.toMatchObject({
      code: "INVALID_PROJECT",
    });
    await expect(repo.get("prj_a")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("lists summaries newest first", async () => {
    expect(await repo.list()).toEqual([]);
    await repo.save(make("prj_old", "2026-01-01T00:00:00.000Z"));
    await repo.save({
      ...make("prj_new", "2026-02-01T00:00:00.000Z"),
      scenes: [{ id: "s", narration: "", status: "draft" }],
    });
    expect(await repo.list()).toEqual([
      {
        id: "prj_new",
        name: "Dự án prj_new",
        mode: "manual",
        sceneCount: 1,
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "prj_old",
        name: "Dự án prj_old",
        mode: "manual",
        sceneCount: 0,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("does not lose concurrent updates, even from two separate connection pools", async () => {
    await repo.save(make("prj_a"));
    // A second pool stands in for the other process (web app vs worker).
    const other = new PgProjectRepository(testDb.connect().db);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 === 0 ? repo : other).update("prj_a", (p) => ({
          ...p,
          scenes: [...p.scenes, { id: `scn_${String(i)}`, narration: String(i), status: "draft" as const }],
        })),
      ),
    );
    expect((await repo.get("prj_a")).scenes).toHaveLength(20);
    expect((await repo.list())[0]?.sceneCount).toBe(20);
  });

  it("keeps the stored project when an update fails or changes the id", async () => {
    await repo.save(make("prj_a"));
    await expect(
      repo.update("prj_a", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(repo.update("prj_a", (p) => ({ ...p, id: "prj_b" }))).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
    await expect(repo.update("prj_missing", (p) => p)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect(await repo.get("prj_a")).toEqual(make("prj_a"));
  });

  it("removes a project and reports an unknown one", async () => {
    await repo.save(make("prj_a"));
    await repo.save(make("prj_b"));
    await repo.remove("prj_a");
    await expect(repo.get("prj_a")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect((await repo.list()).map((summary) => summary.id)).toEqual(["prj_b"]);
    await expect(repo.remove("prj_a")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(repo.remove("../../etc")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});
