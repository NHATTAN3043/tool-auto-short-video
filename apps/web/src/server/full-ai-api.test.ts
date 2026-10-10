import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Project, RenderJob } from "@studio/domain";
import { FakeAi, FakeTts } from "@studio/services/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as estimateRoute } from "@/app/api/projects/[id]/full-ai/estimate/route";
import { GET as resultRoute } from "@/app/api/projects/[id]/full-ai/jobs/[jobId]/route";
import { POST as jobsRoute } from "@/app/api/projects/[id]/full-ai/jobs/route";
import { POST as createRoute } from "@/app/api/projects/route";

import { resetContainer } from "./container";

const request = { idea: "Mèo đi học", targetDurationSec: 30, rankingMode: "text", replaceScenes: false };

describe("Full AI API", () => {
  let dir = "";
  let ai: FakeAi;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-full-ai-"));
    vi.stubEnv("STUDIO_STORAGE_DIR", dir);
    vi.stubEnv("DATABASE_URL", "");
    ai = new FakeAi();
    resetContainer({ ai, tts: new FakeTts() });
  });

  afterEach(() => {
    resetContainer();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

  async function project(mode: "manual" | "full_ai" = "full_ai"): Promise<Project> {
    const res = await createRoute(post({ name: "Full AI", mode }));
    return (await res.json()) as Project;
  }

  it("estimates the steps, their cost and the budgets without a paid call", async () => {
    const p = await project();
    const res = await estimateRoute(post({ request }), ctx(p.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      steps: ["script", "scenes", "media", "rank", "select", "voice"],
      budget: { allowed: true },
    });
    expect(ai.calls).toEqual([]);
  });

  it("queues one job per project and gives the result only once it finished", async () => {
    const p = await project();
    const res = await jobsRoute(post({ request }), ctx(p.id));
    expect(res.status).toBe(202);
    const job = (await res.json()) as RenderJob;
    expect(job).toMatchObject({ kind: "full_ai", status: "QUEUED" });
    expect(((await (await jobsRoute(post({ request }), ctx(p.id))).json()) as RenderJob).id).toBe(job.id);
    const early = await resultRoute(new Request("http://x"), {
      params: Promise.resolve({ id: p.id, jobId: job.id }),
    });
    expect(early.status).toBe(409);
  });

  it("rejects invalid requests and answers 404 without an AI provider", async () => {
    const p = await project();
    expect((await estimateRoute(post({ request: { ...request, rankingMode: "x" } }), ctx(p.id))).status).toBe(
      400,
    );
    expect((await jobsRoute(post({ request: { ...request, idea: "" } }), ctx(p.id))).status).toBe(400);
    resetContainer({ ai: null });
    const res = await estimateRoute(post({ request }), ctx(p.id));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "AI_UNAVAILABLE" } });
  });
});
