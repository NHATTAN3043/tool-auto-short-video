import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { MODE_PRESETS, type Project, type RenderJob } from "@studio/domain";
import { FakeAi } from "@studio/services/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as estimateRoute } from "@/app/api/projects/[id]/ai/estimate/route";
import { GET as resultRoute } from "@/app/api/projects/[id]/ai/jobs/[jobId]/route";
import { POST as jobsRoute } from "@/app/api/projects/[id]/ai/jobs/route";
import { PUT } from "@/app/api/projects/[id]/route";
import { POST as createRoute } from "@/app/api/projects/route";

import { resetContainer } from "./container";

const task = { type: "script", input: { idea: "Mèo đi học", targetDurationSec: 30 } };

describe("AI API", () => {
  let dir = "";
  let ai: FakeAi;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-ai-"));
    vi.stubEnv("STUDIO_STORAGE_DIR", dir);
    vi.stubEnv("BUDGET_MAX_USD_PER_DAY", "0.1");
    ai = new FakeAi();
    resetContainer({ ai });
  });

  afterEach(() => {
    resetContainer();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

  async function project(mode: "manual" | "full_ai" = "full_ai"): Promise<Project> {
    const res = await createRoute(post({ name: "AI", mode }));
    return (await res.json()) as Project;
  }

  it("estimates the cost and the budgets without calling the AI", async () => {
    const p = await project();
    const res = await estimateRoute(post({ task }), ctx(p.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      model: "fake-model",
      maxUsd: 0.042,
      budget: { allowed: true, limits: { perDayUsd: 0.1 }, spent: { dayUsd: 0, projectUsd: 0 } },
    });
    expect(ai.calls).toEqual([]);
  });

  it("queues a job and only gives the result once the worker has finished it", async () => {
    const p = await project();
    const res = await jobsRoute(post({ task }), ctx(p.id));
    expect(res.status).toBe(202);
    const job = (await res.json()) as RenderJob;
    expect(job).toMatchObject({ kind: "ai", status: "QUEUED" });
    const early = await resultRoute(new Request("http://x"), {
      params: Promise.resolve({ id: p.id, jobId: job.id }),
    });
    expect(early.status).toBe(409);
  });

  it("blocks requests over a budget with 402 and says which budget", async () => {
    vi.stubEnv("BUDGET_MAX_USD_PER_CALL", "0.01");
    resetContainer({ ai });
    const p = await project();
    const res = await jobsRoute(post({ task }), ctx(p.id));
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BUDGET_EXCEEDED");
    expect(body.error.message).toContain("mỗi lần gọi");
  });

  it("rejects tasks whose toggle is off, and invalid bodies", async () => {
    const p = await project("manual");
    expect((await jobsRoute(post({ task }), ctx(p.id))).status).toBe(409);
    const assisted = { ...p, automationSettings: { ...MODE_PRESETS.assisted } };
    await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(assisted) }), ctx(p.id));
    expect((await jobsRoute(post({ task }), ctx(p.id))).status).toBe(409);
    expect((await jobsRoute(post({ task: { type: "script", input: { idea: "" } } }), ctx(p.id))).status).toBe(
      400,
    );
  });

  it("answers 404 AI_UNAVAILABLE without a provider", async () => {
    resetContainer({ ai: null });
    const p = await project();
    for (const res of [
      await estimateRoute(post({ task }), ctx(p.id)),
      await jobsRoute(post({ task }), ctx(p.id)),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "AI_UNAVAILABLE" } });
    }
  });
});
