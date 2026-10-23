import { describe, expect, it } from "vitest";

import { ClipAnalysisSchema, MAX_SHOTS, SHOT_DESCRIPTION_MAX_LENGTH } from "./clip-analysis";
import { RenderJobSchema } from "../render/schema";
import {
  buildClipAnalysis,
  expectedShotCount,
  maxShotCount,
  type ShotDescription,
} from "./shot-descriptions";

const spans = [
  { startMs: 0, endMs: 2000 },
  { startMs: 2000, endMs: 5000 },
  { startMs: 5000, endMs: 9000 },
];
const meta = { model: "claude-sonnet-5-5", analyzedAt: "2026-10-23T00:00:00.000Z" };
const described = (index: number, extra: Partial<ShotDescription> = {}): ShotDescription => ({
  index,
  description: `Shot ${String(index)}`,
  tags: ["Cat", " sofa "],
  textOverlay: false,
  ...extra,
});

describe("buildClipAnalysis", () => {
  it("joins each shot's times with its description, tags normalized, in time order", () => {
    const analysis = buildClipAnalysis(
      spans,
      { shots: [described(2, { textOverlay: true }), described(0), described(1)] },
      { ...meta, thumbnailPaths: ["shots/a/0.jpg", "shots/a/1.jpg", "shots/a/2.jpg"] },
    );
    expect(analysis.shots).toEqual([
      {
        index: 0,
        startMs: 0,
        endMs: 2000,
        description: "Shot 0",
        tags: ["cat", "sofa"],
        textOverlay: false,
        thumbnailPath: "shots/a/0.jpg",
      },
      expect.objectContaining({ index: 1, startMs: 2000, endMs: 5000 }),
      expect.objectContaining({ index: 2, textOverlay: true }),
    ]);
    expect(ClipAnalysisSchema.safeParse(analysis).success).toBe(true);
  });

  it("trims descriptions that are too long", () => {
    const long = "x".repeat(SHOT_DESCRIPTION_MAX_LENGTH + 50);
    const analysis = buildClipAnalysis(
      spans,
      { shots: [described(0, { description: `  ${long}` }), described(1), described(2)] },
      meta,
    );
    expect(analysis.shots[0]?.description).toHaveLength(SHOT_DESCRIPTION_MAX_LENGTH);
    expect(analysis.shots[0]?.thumbnailPath).toBeUndefined();
  });

  it.each([
    ["a missing shot", [described(0), described(1)]],
    ["an extra shot", [described(0), described(1), described(2), described(3)]],
    ["a repeated number", [described(0), described(1), described(1)]],
    ["a number out of range", [described(0), described(1), described(5)]],
  ])("refuses an answer with %s", (_label, shots) => {
    expect(() => buildClipAnalysis(spans, { shots }, meta)).toThrow(
      expect.objectContaining({ code: "AI_INVALID_OUTPUT" }) as Error,
    );
  });
});

describe("shot counts for cost estimates", () => {
  it("expects about one shot per 4 seconds and reserves for one per 1.2 seconds, capped", () => {
    expect(expectedShotCount(120_000)).toBe(30);
    expect(maxShotCount(120_000)).toBe(MAX_SHOTS);
    expect(maxShotCount(12_000)).toBe(10);
    expect([expectedShotCount(500), maxShotCount(500)]).toEqual([1, 1]);
    expect(expectedShotCount(600_000)).toBe(MAX_SHOTS);
  });
});

describe("clip jobs", () => {
  const job = {
    id: "job_1",
    projectId: "prj_1",
    kind: "clip",
    status: "QUEUED",
    progress: 0,
    createdAt: "2026-10-23T00:00:00.000Z",
  };

  it("carries the videos to analyze and the cost reservation", () => {
    expect(RenderJobSchema.safeParse({ ...job, clip: { libraryIds: ["lib_1"], maxUsd: 0.1 } }).success).toBe(
      true,
    );
    expect(RenderJobSchema.safeParse({ ...job, clip: { libraryIds: [], maxUsd: 0.1 } }).success).toBe(false);
    const tooMany = Array.from({ length: 21 }, (_, i) => `lib_${String(i)}`);
    expect(RenderJobSchema.safeParse({ ...job, clip: { libraryIds: tooMany, maxUsd: 1 } }).success).toBe(
      false,
    );
  });
});
