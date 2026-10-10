import { describe, expect, it } from "vitest";

import { clampSegment, loopPosition, segmentFromSlider, setEdgeAt, sliderValues } from "./segment";

const D = 30_000;

describe("segment picker rules", () => {
  it("keeps segments inside the video and at least 100 ms long", () => {
    expect(clampSegment({ sourceStartMs: -5, sourceEndMs: 40_000 }, D)).toEqual({
      sourceStartMs: 0,
      sourceEndMs: 30_000,
    });
    expect(clampSegment({ sourceStartMs: 5000, sourceEndMs: 5000 }, D)).toEqual({
      sourceStartMs: 5000,
      sourceEndMs: 5100,
    });
    expect(clampSegment({ sourceStartMs: 30_000, sourceEndMs: null }, D)).toEqual({
      sourceStartMs: 29_900,
      sourceEndMs: null,
    });
    expect(clampSegment({ sourceStartMs: 29_990, sourceEndMs: 30_000 }, D)).toEqual({
      sourceStartMs: 29_900,
      sourceEndMs: 30_000,
    });
  });

  it("maps to and from the two-thumb slider, keeping an open end open", () => {
    const open = { sourceStartMs: 2000, sourceEndMs: null };
    expect(sliderValues(open, D)).toEqual([2000, D]);
    expect(segmentFromSlider([4000, D], open, D)).toEqual({ sourceStartMs: 4000, sourceEndMs: null });
    expect(segmentFromSlider([4000, 9000], open, D)).toEqual({ sourceStartMs: 4000, sourceEndMs: 9000 });
    expect(segmentFromSlider([15_000, 22_000], { sourceStartMs: 0, sourceEndMs: 5000 }, D)).toEqual({
      sourceStartMs: 15_000,
      sourceEndMs: 22_000,
    });
  });

  it("sets an edge at the playhead", () => {
    const seg = { sourceStartMs: 1000, sourceEndMs: 8000 };
    expect(setEdgeAt(seg, "start", 3000, D)).toEqual({ sourceStartMs: 3000, sourceEndMs: 8000 });
    expect(setEdgeAt(seg, "start", 9000, D)).toEqual({ sourceStartMs: 9000, sourceEndMs: null });
    expect(setEdgeAt(seg, "end", 6000, D)).toEqual({ sourceStartMs: 1000, sourceEndMs: 6000 });
    expect(setEdgeAt(seg, "end", 500, D)).toEqual({ sourceStartMs: 1000, sourceEndMs: 1100 });
  });

  it("loops the preview at the end of a closed segment only", () => {
    expect(loopPosition(22_000, { sourceStartMs: 15_000, sourceEndMs: 22_000 })).toBe(15_000);
    expect(loopPosition(18_000, { sourceStartMs: 15_000, sourceEndMs: 22_000 })).toBeNull();
    expect(loopPosition(29_000, { sourceStartMs: 15_000, sourceEndMs: null })).toBeNull();
  });
});
