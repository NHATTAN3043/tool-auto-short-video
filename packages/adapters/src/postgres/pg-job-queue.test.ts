import { createProject, type RenderJob } from "@studio/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PgDatabase } from "./database";
import { PgJobQueue } from "./pg-job-queue";
import { PgProjectRepository } from "./pg-project-repository";
import { createTestDatabase, TEST_DATABASE_URL, truncateAll, type TestDatabase } from "./test-database";

const job = (id: string, createdAt: string, projectId = "prj_1"): RenderJob => ({
  id,
  projectId,
  status: "QUEUED",
  progress: 0,
  createdAt,
});

const clock = { now: () => "2026-06-01T00:00:00.000Z" };

describe.skipIf(TEST_DATABASE_URL === undefined)("PgJobQueue", () => {
  let testDb: TestDatabase;
  let database: PgDatabase;
  let queue: PgJobQueue;

  beforeAll(async () => {
    testDb = await createTestDatabase(TEST_DATABASE_URL ?? "");
    database = testDb.connect();
    queue = new PgJobQueue(database.db, clock);
  });

  afterAll(async () => {
    await testDb.drop();
  });

  beforeEach(async () => {
    await truncateAll(database);
    const repo = new PgProjectRepository(database.db);
    for (const id of ["prj_1", "prj_2"]) {
      await repo.save(createProject({ name: id, mode: "manual" }, { newId: () => id }));
    }
  });

  it("stores a job and refuses a duplicate id", async () => {
    await queue.enqueue(job("job_1", "2026-01-01T00:00:00.000Z"));
    expect(await queue.get("job_1")).toEqual(job("job_1", "2026-01-01T00:00:00.000Z"));
    await expect(queue.enqueue(job("job_1", "2026-01-01T00:00:00.000Z"))).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
  });

  it("claims queued jobs oldest first, once each", async () => {
    await queue.enqueue(job("job_late", "2026-01-02T00:00:00.000Z"));
    await queue.enqueue(job("job_early", "2026-01-01T00:00:00.000Z"));

    const claimed = await Promise.all([queue.claimNext(), queue.claimNext(), queue.claimNext()]);
    expect(claimed.map((j) => j?.id ?? null).sort()).toEqual(["job_early", "job_late", null].sort());
    expect(await queue.get("job_early")).toMatchObject({
      status: "PROCESSING",
      startedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("never hands the same job to two workers", async () => {
    for (let i = 0; i < 10; i++) {
      await queue.enqueue(job(`job_${String(i)}`, `2026-01-01T00:00:0${String(i)}.000Z`));
    }
    const other = new PgJobQueue(testDb.connect().db, clock);
    const claimed = await Promise.all(
      Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? queue : other).claimNext()),
    );
    const ids = claimed.flatMap((j) => (j ? [j.id] : []));
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it("updates progress and status", async () => {
    await queue.enqueue(job("job_1", "2026-01-01T00:00:00.000Z"));
    await queue.update("job_1", { progress: 0.5 });
    const done = await queue.update("job_1", {
      status: "COMPLETED",
      progress: 1,
      outputPath: "render/out.mp4",
      srtPath: "render/out.srt",
      completedAt: "2026-06-02T00:00:00.000Z",
    });
    expect(done).toMatchObject({
      id: "job_1",
      status: "COMPLETED",
      progress: 1,
      outputPath: "render/out.mp4",
    });
    expect(await queue.get("job_1")).toEqual(done);
    await expect(queue.update("job_1", { progress: 5 })).rejects.toThrow();
    expect(await queue.get("job_1")).toEqual(done);
  });

  it("keeps the task and cost of an ai job", async () => {
    const ai = {
      task: { type: "script" as const, input: { idea: "Mèo", targetDurationSec: 30 } },
      maxUsd: 0.04,
    };
    await queue.enqueue({ ...job("job_1", "2026-01-01T00:00:00.000Z"), kind: "ai", ai });
    expect((await queue.get("job_1")).ai).toEqual(ai);
    const done = await queue.update("job_1", { status: "COMPLETED", ai: { ...ai, costUsd: 0.01 } });
    expect((await queue.get("job_1")).ai).toEqual(done.ai);
  });

  it("keeps the request, step and cost of a full_ai job", async () => {
    const fullAi = {
      request: { idea: "Mèo", targetDurationSec: 30, rankingMode: "vision" as const, replaceScenes: true },
      steps: ["script" as const, "scenes" as const, "voice" as const],
      maxUsd: 0.5,
    };
    await queue.enqueue({ ...job("job_1", "2026-01-01T00:00:00.000Z"), kind: "full_ai", fullAi });
    expect((await queue.get("job_1")).fullAi).toEqual(fullAi);
    await queue.update("job_1", { fullAi: { ...fullAi, step: "scenes", costUsd: 0.02 } });
    expect((await queue.get("job_1")).fullAi).toEqual({ ...fullAi, step: "scenes", costUsd: 0.02 });
  });

  it("keeps the videos and cost of a clip job (ADR 0019)", async () => {
    const clip = { libraryIds: ["lib_1", "lib_2"], reanalyze: true, maxUsd: 0.12 };
    await queue.enqueue({ ...job("job_1", "2026-01-01T00:00:00.000Z"), kind: "clip", clip });
    expect((await queue.get("job_1")).clip).toEqual(clip);
    await queue.update("job_1", { clip: { ...clip, costUsd: 0.05 } });
    expect((await queue.get("job_1")).clip).toEqual({ ...clip, costUsd: 0.05 });
  });

  it("keeps the scenes of a tts job", async () => {
    await queue.enqueue({
      ...job("job_1", "2026-01-01T00:00:00.000Z"),
      kind: "tts",
      sceneIds: ["scn_1", "scn_2"],
    });
    expect(await queue.get("job_1")).toMatchObject({ kind: "tts", sceneIds: ["scn_1", "scn_2"] });
    expect("sceneIds" in (await queue.update("job_1", { progress: 0.5 }))).toBe(true);
  });

  it("keeps the kind of a CapCut export", async () => {
    await queue.enqueue({ ...job("job_1", "2026-01-01T00:00:00.000Z"), kind: "capcut" });
    expect((await queue.get("job_1")).kind).toBe("capcut");
  });

  it("filters by project and status, oldest first", async () => {
    await queue.enqueue(job("job_a", "2026-01-01T00:00:00.000Z", "prj_1"));
    await queue.enqueue(job("job_b", "2026-01-02T00:00:00.000Z", "prj_2"));
    await queue.update("job_b", { status: "FAILED", errorMessage: "x" });

    expect((await queue.list()).map((j) => j.id)).toEqual(["job_a", "job_b"]);
    expect((await queue.list({ projectId: "prj_2" })).map((j) => j.id)).toEqual(["job_b"]);
    expect((await queue.list({ status: "QUEUED" })).map((j) => j.id)).toEqual(["job_a"]);
  });

  it("is empty at first and reports unknown ids", async () => {
    expect(await queue.list()).toEqual([]);
    expect(await queue.claimNext()).toBeNull();
    await expect(queue.get("job_missing")).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
    await expect(queue.update("job_missing", { progress: 1 })).rejects.toMatchObject({
      code: "JOB_NOT_FOUND",
    });
    await expect(queue.enqueue(job("../secret", "2026-01-01T00:00:00.000Z"))).rejects.toMatchObject({
      code: "JOB_NOT_FOUND",
    });
  });

  it("removes the jobs of one project, also when the project row is deleted", async () => {
    await queue.enqueue(job("job_a", "2026-01-01T00:00:00.000Z", "prj_1"));
    await queue.enqueue(job("job_b", "2026-01-02T00:00:00.000Z", "prj_2"));
    await queue.removeForProject("prj_1");
    expect((await queue.list()).map((j) => j.id)).toEqual(["job_b"]);
    await new PgProjectRepository(database.db).remove("prj_2");
    expect(await queue.list()).toEqual([]);
  });
});
