import {
  createProject,
  MODE_PRESETS,
  type FullAiResult,
  type MediaCandidate,
  type Project,
  type RenderJob,
} from "@studio/domain";
import { describe, expect, it } from "vitest";

import type { FullAiEstimate } from "./api";
import {
  alternativesFor,
  costLines,
  formError,
  initialForm,
  isRunning,
  progressLine,
  reviewStats,
  stepsLine,
  toRequest,
} from "./model";

const base = (): Project => ({
  ...createProject({ name: "P", mode: "full_ai" }, { newId: () => "prj_1" }),
  automationSettings: { ...MODE_PRESETS.full_ai },
});

const job = (extra: Partial<RenderJob>): RenderJob => ({
  id: "job_1",
  projectId: "prj_1",
  kind: "full_ai",
  status: "PROCESSING",
  progress: 0.4,
  createdAt: "2026-10-10T00:00:00.000Z",
  fullAi: {
    request: { idea: "Mèo", targetDurationSec: 30, rankingMode: "text", replaceScenes: false },
    steps: ["script", "scenes", "voice"],
    maxUsd: 0.5,
  },
  ...extra,
});

describe("Full AI form", () => {
  it("starts from the remembered ranking mode", () => {
    expect(initialForm(base()).rankingMode).toBe("text");
    expect(initialForm({ ...base(), mediaRankingMode: "vision" }).rankingMode).toBe("vision");
  });

  it("needs an idea when AI writes the script, otherwise the project's script", () => {
    const form = { ...initialForm(base()), idea: "ab" };
    expect(formError(form, ["script", "scenes"], base())).toContain("ý tưởng");
    expect(formError({ ...form, idea: "Mèo đi học" }, ["script", "scenes"], base())).toBeNull();
    expect(formError(form, ["scenes"], base())).toContain("Viết script trước");
    expect(formError(form, ["scenes"], { ...base(), script: "Có script." })).toBeNull();
  });

  it("builds the request without empty optional fields", () => {
    expect(
      toRequest({ idea: " Mèo ", targetDurationSec: 45, tone: " ", rankingMode: "vision" }, true),
    ).toEqual({
      idea: "Mèo",
      targetDurationSec: 45,
      rankingMode: "vision",
      replaceScenes: true,
    });
  });
});

describe("Full AI progress", () => {
  it("names the steps and the current one", () => {
    expect(stepsLine(["script", "scenes", "voice"])).toBe("Viết script → Chia cảnh → Tạo giọng");
    expect(progressLine(job({ status: "QUEUED" }))).toBe("Đang chờ worker…");
    expect(progressLine(job({}))).toBe("Đang bắt đầu… · 40%");
    const info = job({}).fullAi;
    if (!info) throw new Error("the fixture has Full AI info");
    expect(progressLine(job({ fullAi: { ...info, step: "scenes" } }))).toBe("Bước 2/3: Chia cảnh · 40%");
    expect(isRunning(job({}))).toBe(true);
    expect(isRunning(job({ status: "FAILED" }))).toBe(false);
    expect(isRunning(null)).toBe(false);
  });

  it("lists the cost of each paid step", () => {
    const estimate: FullAiEstimate = {
      steps: ["script", "scenes", "media"],
      costs: [{ step: "script", expectedUsd: 0.005, maxUsd: 0.04 }],
      sceneCount: 5,
      expectedUsd: 0.005,
      maxUsd: 0.04,
      budget: {
        allowed: true,
        blockedBy: null,
        limits: { perCallUsd: null, perDayUsd: null, perMonthUsd: null, perProjectUsd: null },
        spent: { dayUsd: 0, monthUsd: 0, projectUsd: 0 },
        planned: { totalUsd: 0.04, maxCallUsd: 0.04 },
      },
    };
    expect(costLines(estimate)).toEqual(["Viết script: ≈ 0,005 USD (tối đa 0,040 USD)"]);
  });
});

describe("review", () => {
  const candidate = (ref: string): MediaCandidate => ({
    provider: "pexels",
    ref,
    kind: "video",
    width: 1080,
    height: 1920,
    thumbnail: { type: "remote", url: `https://images.pexels.com/${ref}.jpg` },
  });

  const project = (): Project => ({
    ...base(),
    voice: { provider: "fake", voiceId: "v", modelId: "m", stability: 0.5, similarityBoost: 0.75, speed: 1 },
    assets: [
      {
        id: "ast_1",
        kind: "video",
        source: "pexels",
        fileName: "pexels-a.mp4",
        path: "media/ast_1.mp4",
        createdAt: "2026-10-10T00:00:00.000Z",
      },
    ],
    scenes: [
      {
        id: "s1",
        narration: "Một.",
        status: "approved",
        media: { assetId: "ast_1", sourceStartMs: 0, fit: "cover", focusX: 0.5, volume: 0, kenBurns: false },
      },
      { id: "s2", narration: "Hai.", status: "draft" },
    ],
  });

  it("counts kept scenes, media and voices to redo", () => {
    expect(reviewStats(project())).toEqual({ total: 2, approved: 1, withMedia: 1, voiceToRedo: 2 });
  });

  it("offers the ranked candidates a scene does not use yet", () => {
    const result: FullAiResult = {
      scenes: [{ sceneId: "s1", candidates: [candidate("a"), candidate("b")] }],
      warnings: [],
    };
    expect(alternativesFor(result, project(), "s1").map((c) => c.ref)).toEqual(["b"]);
    expect(alternativesFor(result, project(), "s2")).toEqual([]);
    expect(alternativesFor(null, project(), "s1")).toEqual([]);
  });
});
