import { describe, expect, it } from "vitest";

import {
  ClipAnalysisSchema,
  MAX_SHOT_MS,
  MAX_SHOTS,
  MIN_SHOT_MS,
  shotMiddleMs,
  shotsFromCuts,
  type ClipShot,
  type ShotSpan,
} from "./clip-analysis";
import { LibraryMediaSchema, unanalyzedUploads, uploadSourceRef, type LibraryMedia } from "./media-library";

const lengths = (spans: readonly ShotSpan[]) => spans.map((span) => span.endMs - span.startMs);

/** Spans start at 0, end at the clip's end, and touch each other. */
function expectCovers(spans: readonly ShotSpan[], durationMs: number): void {
  expect(spans[0]?.startMs).toBe(0);
  expect(spans.at(-1)?.endMs).toBe(durationMs);
  spans.slice(1).forEach((span, i) => {
    expect(span.startMs).toBe(spans[i]?.endMs);
  });
}

describe("shotsFromCuts", () => {
  it("keeps the shots between the cuts when they are all within limits", () => {
    expect(shotsFromCuts([2000, 5000], 9000)).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 2000, endMs: 5000 },
      { startMs: 5000, endMs: 9000 },
    ]);
  });

  it("splits a clip without cuts into equal parts of at most MAX_SHOT_MS", () => {
    const spans = shotsFromCuts([], 20_000);
    expect(lengths(spans)).toEqual([6667, 6666, 6667]);
    expectCovers(spans, 20_000);
  });

  it("merges a burst of quick cuts, each short shot into its shorter neighbour", () => {
    // 0–3000, then 300ms flashes, then 3000–7000
    const spans = shotsFromCuts([3000, 3300, 3600, 4000], 7000);
    expect(lengths(spans).every((ms) => ms >= MIN_SHOT_MS)).toBe(true);
    expectCovers(spans, 7000);
    expect(spans).toEqual([
      { startMs: 0, endMs: 4000 },
      { startMs: 4000, endMs: 7000 },
    ]);
  });

  it("merges a short last shot into the one before", () => {
    expect(shotsFromCuts([4000], 4500)).toEqual([{ startMs: 0, endMs: 4500 }]);
  });

  it("ignores cuts that are duplicated, unsorted, fractional or outside the clip", () => {
    expect(shotsFromCuts([5000.4, -10, 2000, 2000, 0, 9000, 12_000], 9000)).toEqual(
      shotsFromCuts([2000, 5000], 9000),
    );
  });

  it("keeps a clip shorter than MIN_SHOT_MS as one shot, and an empty clip as none", () => {
    expect(shotsFromCuts([400], 900)).toEqual([{ startMs: 0, endMs: 900 }]);
    expect(shotsFromCuts([], 0)).toEqual([]);
  });

  it("never returns more than MAX_SHOTS, merging the shortest neighbours first", () => {
    // A 5-minute clip cut every 2 seconds: 150 shots before the cap.
    const cuts = Array.from({ length: 149 }, (_, i) => (i + 1) * 2000);
    const spans = shotsFromCuts(cuts, 300_000);
    expect(spans).toHaveLength(MAX_SHOTS);
    expectCovers(spans, 300_000);
    expect(Math.max(...lengths(spans)) - Math.min(...lengths(spans))).toBeLessThanOrEqual(4000);
  });

  it("keeps every shot within the limits on a typical clip", () => {
    const spans = shotsFromCuts([1000, 1500, 12_000, 30_500, 31_000, 31_400, 60_000], 95_000);
    expectCovers(spans, 95_000);
    for (const ms of lengths(spans)) {
      expect(ms).toBeGreaterThanOrEqual(MIN_SHOT_MS);
      expect(ms).toBeLessThanOrEqual(MAX_SHOT_MS);
    }
  });

  it("takes the picture from the middle of the shot", () => {
    expect(shotMiddleMs({ startMs: 2000, endMs: 5001 })).toBe(3500);
  });
});

const shot = (index: number, startMs: number, endMs: number, extra: Partial<ClipShot> = {}): ClipShot => ({
  index,
  startMs,
  endMs,
  description: "A cat sleeping on a sofa",
  tags: ["cat", "sofa"],
  textOverlay: false,
  ...extra,
});

const analysis = (shots: ClipShot[]) => ({
  shots,
  model: "claude-sonnet-5-5",
  analyzedAt: "2026-10-23T00:00:00.000Z",
});

describe("ClipAnalysisSchema", () => {
  it("accepts shots numbered in time order", () => {
    expect(ClipAnalysisSchema.safeParse(analysis([shot(0, 0, 2000), shot(1, 2000, 5000)])).success).toBe(
      true,
    );
  });

  it.each([
    ["no shots", []],
    ["a gap in the numbering", [shot(0, 0, 2000), shot(2, 2000, 5000)]],
    ["overlapping shots", [shot(0, 0, 3000), shot(1, 2000, 5000)]],
    ["a shot ending before it starts", [shot(0, 2000, 1000)]],
  ])("rejects %s", (_label, shots) => {
    expect(ClipAnalysisSchema.safeParse(analysis(shots)).success).toBe(false);
  });
});

describe("LibraryMediaSchema with uploads and analysis", () => {
  const stock: LibraryMedia = {
    id: "lib_1",
    kind: "video",
    fileName: "lib_1.mp4",
    path: "files/lib_1.mp4",
    tags: ["cat"],
    usageCount: 0,
    source: "pexels",
    sourceRef: "pexels:video:1",
    contentHash: "sha256:abc",
    createdAt: "2026-10-01T00:00:00.000Z",
  };
  const upload: LibraryMedia = { ...stock, source: "upload", sourceRef: uploadSourceRef("sha256:abc") };

  it("keeps items saved before uploads and analysis valid", () => {
    expect(LibraryMediaSchema.safeParse(stock).success).toBe(true);
  });

  it("identifies an upload by its content hash", () => {
    expect(uploadSourceRef("sha256:abc")).toBe("upload:sha256:abc");
    expect(LibraryMediaSchema.safeParse(upload).success).toBe(true);
    expect(LibraryMediaSchema.safeParse({ ...upload, sourceRef: "upload:sha256:other" }).success).toBe(false);
  });

  it("accepts an analysis on a video only", () => {
    const analyzed = { ...upload, analysis: analysis([shot(0, 0, 2000)]) };
    expect(LibraryMediaSchema.safeParse(analyzed).success).toBe(true);
    expect(LibraryMediaSchema.safeParse({ ...analyzed, kind: "image" }).success).toBe(false);
  });
});

describe("unanalyzedUploads", () => {
  const item = (id: string, extra: Partial<LibraryMedia> = {}): LibraryMedia => ({
    id,
    kind: "video",
    fileName: `${id}.mp4`,
    path: `files/${id}.mp4`,
    tags: [],
    usageCount: 0,
    source: "upload",
    sourceRef: uploadSourceRef(`sha256:${id}`),
    contentHash: `sha256:${id}`,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  });
  const upload = (hash: string) => ({ source: "upload" as const, kind: "video" as const, contentHash: hash });

  it("lists this project's uploaded videos that are not analyzed yet", () => {
    const items = [
      item("a"),
      item("b", { analysis: analysis([shot(0, 0, 2000)]) }),
      item("c"),
      item("p", { source: "pexels", sourceRef: "pexels:video:p" }),
    ];
    const assets = [
      upload("sha256:a"),
      upload("sha256:b"),
      upload("sha256:p"),
      { source: "pexels" as const, kind: "video" as const, contentHash: "sha256:c" },
    ];
    expect(unanalyzedUploads(assets, items).map((i) => i.id)).toEqual(["a"]);
    expect(unanalyzedUploads([], items)).toEqual([]);
  });
});
