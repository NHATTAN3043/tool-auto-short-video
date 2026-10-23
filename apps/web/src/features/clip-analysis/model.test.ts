import { NO_BUDGET_LIMITS } from "@studio/services/testing";
import { checkBudget, type LibraryMedia, type RenderJob } from "@studio/domain";
import { describe, expect, it } from "vitest";

import type { ClipAnalysisEstimate } from "./api";
import {
  analysisLabel,
  canAnalyze,
  clipCostLine,
  clipJobView,
  clipsLine,
  shotTime,
  skippedLines,
} from "./model";

const shot = (index: number, textOverlay = false) => ({
  index,
  startMs: index * 3000,
  endMs: (index + 1) * 3000,
  description: "",
  tags: [],
  textOverlay,
});

const video: Pick<LibraryMedia, "kind" | "analysis"> = { kind: "video" };

describe("analysisLabel / canAnalyze", () => {
  it("says whether a video is analyzed, how many shots it has and how many carry text", () => {
    expect(analysisLabel(video)).toBe("Chưa phân tích");
    const analysis = {
      shots: [shot(0), shot(1, true), shot(2)],
      model: "m",
      analyzedAt: "2026-10-23T00:00:00.000Z",
    };
    expect(analysisLabel({ kind: "video", analysis })).toBe("3 đoạn · 1 có chữ/logo");
    expect(analysisLabel({ kind: "video", analysis: { ...analysis, shots: [shot(0)] } })).toBe("1 đoạn");
  });

  it("leaves images out", () => {
    expect(canAnalyze({ kind: "image" })).toBe(false);
    expect(analysisLabel({ kind: "image" })).toBeNull();
  });
});

describe("estimate lines", () => {
  const estimate: ClipAnalysisEstimate = {
    clips: [
      { id: "lib_a", fileName: "a.mp4", durationMs: 120_000, expectedShots: 30 },
      { id: "lib_b", fileName: "b.mp4", durationMs: 60_000, expectedShots: 15 },
    ],
    skipped: [
      { id: "lib_c", reason: "analyzed" },
      { id: "lib_x", reason: "not_found" },
    ],
    expectedUsd: 0.04,
    maxUsd: 0.21,
    model: "claude-sonnet-5-5",
    budget: checkBudget(
      NO_BUDGET_LIMITS,
      { dayUsd: 0, monthUsd: 0, projectUsd: 0 },
      { totalUsd: 0.21, maxCallUsd: 0.12 },
    ),
  };

  it("sums the shots and shows the typical and worst cost", () => {
    expect(clipsLine(estimate)).toBe("2 video, khoảng 45 đoạn");
    expect(clipCostLine(estimate)).toBe("≈ 0,040 USD (tối đa 0,210 USD) · claude-sonnet-5-5");
  });

  it("names the skipped videos by file name when known", () => {
    const items = [{ id: "lib_c", fileName: "c.mp4" }] as LibraryMedia[];
    expect(skippedLines(estimate, items)).toEqual(["c.mp4: đã phân tích", "lib_x: không còn trong kho"]);
  });
});

describe("clipJobView", () => {
  const job = (extra: Partial<RenderJob>): RenderJob => ({
    id: "job_1",
    projectId: "prj_1",
    kind: "clip",
    clip: { libraryIds: ["lib_a", "lib_b"], maxUsd: 0.2 },
    status: "QUEUED",
    progress: 0,
    createdAt: "2026-10-23T00:00:00.000Z",
    ...extra,
  });

  it("follows the job from the queue to its end, with the real cost", () => {
    expect(clipJobView(job({}))).toEqual({ state: "running", text: "Đang chờ worker (2 video)…" });
    expect(clipJobView(job({ status: "PROCESSING", progress: 0.5 })).text).toBe(
      "Đang phân tích 2 video… 50%",
    );
    expect(
      clipJobView(
        job({ status: "COMPLETED", clip: { libraryIds: ["lib_a", "lib_b"], maxUsd: 0.2, costUsd: 0.031 } }),
      ),
    ).toEqual({ state: "done", text: "Đã phân tích 2 video · 0,031 USD" });
    expect(
      clipJobView(job({ status: "FAILED", errorMessage: "Không phân tích được 1/2 video: a.mp4: x" })),
    ).toEqual({
      state: "failed",
      text: "Không phân tích được 1/2 video: a.mp4: x",
    });
  });
});

describe("shotTime", () => {
  it("shows minutes, seconds and tenths", () => {
    expect(shotTime(0)).toBe("0:00,0");
    expect(shotTime(72_450)).toBe("1:12,5");
  });
});
