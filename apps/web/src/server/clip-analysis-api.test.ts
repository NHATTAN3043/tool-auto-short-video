import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { JsonMediaLibrary } from "@studio/adapters";
import { uploadSourceRef, type Project, type RenderJob } from "@studio/domain";
import { FakeAi } from "@studio/services/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as estimateRoute } from "@/app/api/projects/[id]/clip-analysis/estimate/route";
import { POST as jobsRoute } from "@/app/api/projects/[id]/clip-analysis/jobs/route";
import { GET as fileRoute } from "@/app/api/media-library/[id]/file/route";
import { POST as createRoute } from "@/app/api/projects/route";

import { resetContainer } from "./container";

describe("clip analysis API (ADR 0019)", () => {
  let dir = "";
  let ai: FakeAi;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-clip-"));
    vi.stubEnv("STUDIO_STORAGE_DIR", dir);
    ai = new FakeAi();
    resetContainer({ ai });
    await new JsonMediaLibrary(dir).add({
      id: "lib_a",
      kind: "video",
      fileName: "meo.mp4",
      path: "files/lib_a.mp4",
      durationMs: 120_000,
      tags: [],
      usageCount: 0,
      source: "upload",
      sourceRef: uploadSourceRef("sha256:a"),
      contentHash: "sha256:a",
      createdAt: "2026-10-23T00:00:00.000Z",
    });
  });

  afterEach(() => {
    resetContainer();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

  async function project(): Promise<Project> {
    const res = await createRoute(post({ name: "Clip", mode: "manual" }));
    return (await res.json()) as Project;
  }

  it("estimates without any AI call, then queues one clip job for the worker", async () => {
    const p = await project();
    const estimate = await estimateRoute(post({ libraryIds: ["lib_a", "lib_x"] }), ctx(p.id));
    expect(estimate.status).toBe(200);
    expect(await estimate.json()).toMatchObject({
      clips: [{ id: "lib_a", fileName: "meo.mp4", expectedShots: 30 }],
      skipped: [{ id: "lib_x", reason: "not_found" }],
      model: "fake-model",
      budget: { allowed: true },
    });
    expect(ai.shotCalls).toEqual([]);

    const res = await jobsRoute(post({ libraryIds: ["lib_a"] }), ctx(p.id));
    expect(res.status).toBe(202);
    expect((await res.json()) as RenderJob).toMatchObject({
      kind: "clip",
      projectId: p.id,
      status: "QUEUED",
      clip: { libraryIds: ["lib_a"] },
    });
  });

  it("refuses invalid bodies and answers 404 without an AI provider", async () => {
    const p = await project();
    expect((await jobsRoute(post({ libraryIds: [] }), ctx(p.id))).status).toBe(400);
    resetContainer({ ai: null });
    expect((await estimateRoute(post({ libraryIds: ["lib_a"] }), ctx(p.id))).status).toBe(404);
  });

  it("answers 404 for the still of a shot that does not exist", async () => {
    const res = await fileRoute(new Request("http://x/?file=shot&shot=3"), ctx("lib_a"));
    expect(res.status).toBe(404);
  });
});
