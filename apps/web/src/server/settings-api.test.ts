import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { JsonApiUsageLog } from "@studio/adapters/repository-json";
import type { Project } from "@studio/domain";
import { FakeAi } from "@studio/services/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as aiJobsRoute } from "@/app/api/projects/[id]/ai/jobs/route";
import { POST as createRoute } from "@/app/api/projects/route";
import { GET as getBudget, PUT as putBudget } from "@/app/api/settings/budget/route";
import { GET as getUsage } from "@/app/api/usage/route";

import { resetContainer } from "./container";

const limits = { perCallUsd: 0.25, perDayUsd: null, perMonthUsd: 10, perProjectUsd: 0 };

describe("budget settings API", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-budget-"));
    vi.stubEnv("STUDIO_STORAGE_DIR", dir);
    vi.stubEnv("DATABASE_URL", "");
    resetContainer({ ai: new FakeAi() });
  });

  afterEach(() => {
    resetContainer();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const put = (body: unknown) => new Request("http://x", { method: "PUT", body: JSON.stringify(body) });

  it("shows the environment defaults, then the saved budgets", async () => {
    const defaults = { perCallUsd: 0.5, perDayUsd: 2, perMonthUsd: 20, perProjectUsd: 1 };
    expect(await (await getBudget()).json()).toEqual({ limits: defaults, defaults, updatedAt: null });

    const res = await putBudget(put({ limits }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ limits, defaults });
    expect(await (await getBudget()).json()).toMatchObject({ limits });
  });

  it("rejects negative or missing limits", async () => {
    expect((await putBudget(put({ limits: { ...limits, perDayUsd: -1 } }))).status).toBe(400);
    expect((await putBudget(put({ limits: { perCallUsd: 1 } }))).status).toBe(400);
  });

  it("applies saved budgets to the next paid request", async () => {
    const created = await createRoute(
      new Request("http://x", { method: "POST", body: JSON.stringify({ name: "P", mode: "full_ai" }) }),
    );
    const project = (await created.json()) as Project;
    await putBudget(put({ limits }));
    const res = await aiJobsRoute(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          task: { type: "script", input: { idea: "Mèo đi học", targetDurationSec: 30 } },
        }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: { code: "BUDGET_EXCEEDED", message: expect.stringContaining("mỗi dự án") as unknown },
    });
  });

  it("reports spend per project from the usage log", async () => {
    const created = await createRoute(
      new Request("http://x", { method: "POST", body: JSON.stringify({ name: "Mèo", mode: "manual" }) }),
    );
    const project = (await created.json()) as Project;
    await new JsonApiUsageLog(dir).append({
      id: "use_1",
      service: "tts",
      provider: "elevenlabs",
      operation: "speech",
      projectId: project.id,
      status: "ok",
      estimatedUsd: 0.02,
      usd: 0.02,
      characters: 60,
      createdAt: new Date().toISOString(),
    });
    const res = await getUsage();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      dayUsd: 0.02,
      totalUsd: 0.02,
      byProject: [{ projectId: project.id, projectName: "Mèo", totalUsd: 0.02, calls: 1 }],
      recent: [{ id: "use_1" }],
    });
  });
});
