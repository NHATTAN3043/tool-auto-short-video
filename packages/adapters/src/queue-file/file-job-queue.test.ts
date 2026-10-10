import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RenderJob } from "@studio/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileJobQueue } from "./file-job-queue";

const job = (id: string, createdAt: string, projectId = "prj_1"): RenderJob => ({
  id,
  projectId,
  status: "QUEUED",
  progress: 0,
  createdAt,
});

describe("FileJobQueue", () => {
  let root = "";
  let queue: FileJobQueue;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "studio-queue-"));
    queue = new FileJobQueue(root, { now: () => "2026-06-01T00:00:00.000Z" });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("stores each job as jobs/<id>.json", async () => {
    await queue.enqueue(job("job_1", "2026-01-01T00:00:00.000Z"));
    expect(readdirSync(path.join(root, "jobs"))).toEqual(["job_1.json"]);
    expect(await queue.get("job_1")).toEqual(job("job_1", "2026-01-01T00:00:00.000Z"));
    await expect(queue.enqueue(job("job_1", "2026-01-01T00:00:00.000Z"))).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
  });

  it("claims queued jobs oldest first, once each", async () => {
    await queue.enqueue(job("job_late", "2026-01-02T00:00:00.000Z"));
    await queue.enqueue(job("job_early", "2026-01-01T00:00:00.000Z"));

    const claimed = await Promise.all([queue.claimNext(), queue.claimNext(), queue.claimNext()]);
    expect(claimed.map((j) => j?.id ?? null)).toEqual(["job_early", "job_late", null]);
    expect(claimed[0]).toMatchObject({ status: "PROCESSING", startedAt: "2026-06-01T00:00:00.000Z" });
  });

  it("updates progress and status", async () => {
    await queue.enqueue(job("job_1", "2026-01-01T00:00:00.000Z"));
    await queue.update("job_1", { progress: 0.5 });
    const done = await queue.update("job_1", {
      status: "COMPLETED",
      progress: 1,
      outputPath: "render/out.mp4",
    });
    expect(done).toMatchObject({
      id: "job_1",
      status: "COMPLETED",
      progress: 1,
      outputPath: "render/out.mp4",
    });
    expect(await queue.get("job_1")).toEqual(done);
    await expect(queue.update("job_1", { progress: 5 })).rejects.toThrow();
  });

  it("filters by project and status and skips unreadable files", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await queue.enqueue(job("job_a", "2026-01-01T00:00:00.000Z", "prj_1"));
    await queue.enqueue(job("job_b", "2026-01-02T00:00:00.000Z", "prj_2"));
    await queue.update("job_b", { status: "FAILED", errorMessage: "x" });
    writeFileSync(path.join(root, "jobs", "job_broken.json"), "{");
    writeFileSync(path.join(root, "jobs", "notes.txt"), "ignored");

    expect((await queue.list()).map((j) => j.id)).toEqual(["job_a", "job_b"]);
    expect((await queue.list({ projectId: "prj_2" })).map((j) => j.id)).toEqual(["job_b"]);
    expect((await queue.list({ status: "QUEUED" })).map((j) => j.id)).toEqual(["job_a"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("job_broken.json"));
    expect(warn.mock.calls.every(([message]) => String(message).includes("job_broken.json"))).toBe(true);
    warn.mockRestore();
  });

  it("is empty before the jobs folder exists and rejects bad ids", async () => {
    expect(await queue.list()).toEqual([]);
    expect(await queue.claimNext()).toBeNull();
    await expect(queue.get("job_missing")).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
    await expect(queue.get("../secret")).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
    mkdirSync(path.join(root, "jobs"), { recursive: true });
  });

  it("removes the jobs of one project only", async () => {
    await queue.enqueue(job("job_1", "2026-01-01T00:00:00.000Z", "prj_1"));
    await queue.enqueue(job("job_2", "2026-01-02T00:00:00.000Z", "prj_2"));
    await queue.enqueue(job("job_3", "2026-01-03T00:00:00.000Z", "prj_1"));
    await queue.removeForProject("prj_1");
    expect(readdirSync(path.join(root, "jobs"))).toEqual(["job_2.json"]);
    await queue.removeForProject("prj_nope");
    expect((await queue.list()).map((item) => item.id)).toEqual(["job_2"]);
  });
});
