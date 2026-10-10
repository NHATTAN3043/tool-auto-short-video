import { describe, expect, it } from "vitest";

import type { Project } from "../project/schema";
import { asset, project, scene } from "../testing/fixtures";
import { buildCaptions, captionsToSrt, chunkNarration } from "./captions";
import { computeTimeline, timelineDurationMs } from "./compute-timeline";

const spans = (p: Project) =>
  computeTimeline(p).map(({ sceneId, startMs, endMs, source }) => [sceneId, startMs, endMs, source]);

describe("computeTimeline", () => {
  it("is empty for a project without scenes", () => {
    expect(computeTimeline(project())).toEqual([]);
    expect(timelineDurationMs([])).toBe(0);
  });

  it("estimates a single scene with the 1.2s floor", () => {
    expect(computeTimeline(project({ scenes: [scene("a", "Xin chào")] }))).toEqual([
      { sceneId: "a", index: 0, startMs: 0, endMs: 1200, durationMs: 1200, source: "estimate" },
    ]);
  });

  it("applies manual → shared project voice by weight", () => {
    const p = project({
      voiceAssetId: "voice",
      assets: [asset("voice", "audio", { durationMs: 12_000 })],
      scenes: [
        scene("a", "Bất kỳ.", { durationMs: 2000 }),
        // weights 4.5 and 7.5 share the 10s left over
        scene("c", "Một hai ba."),
        scene("d", "Bốn năm sáu bảy tám chín."),
      ],
    });
    expect(spans(p)).toEqual([
      ["a", 0, 2000, "manual"],
      ["c", 2000, 5750, "project-voice"],
      ["d", 5750, 12_000, "project-voice"],
    ]);
    expect(timelineDurationMs(computeTimeline(p))).toBe(12_000);
  });

  it("applies manual → scene voice → estimate when only scene voices exist", () => {
    const p = project({
      assets: [asset("sv", "audio", { durationMs: 5000 })],
      scenes: [
        scene("a", "Bất kỳ.", { durationMs: 2000, voiceAssetId: "sv" }),
        scene("b", "Bất kỳ.", { voiceAssetId: "sv" }),
        scene("c", "Xin chào"),
      ],
    });
    expect(spans(p)).toEqual([
      ["a", 0, 2000, "manual"],
      ["b", 2000, 7000, "scene-voice"],
      ["c", 7000, 8200, "estimate"],
    ]);
  });

  it("times only the chosen voice track when both a project voice and scene voices exist", () => {
    const both = project({
      voiceAssetId: "voice",
      assets: [asset("voice", "audio", { durationMs: 6000 }), asset("sv", "audio", { durationMs: 5000 })],
      scenes: [scene("a", "Một hai.", { voiceAssetId: "sv" }), scene("b", "Ba bốn.")],
    });
    // Default: the whole-video voice wins and the scene voice is ignored.
    expect(spans(both)).toEqual([
      ["a", 0, 3000, "project-voice"],
      ["b", 3000, 6000, "project-voice"],
    ]);
    expect(spans({ ...both, voiceTrack: "scenes" })).toEqual([
      ["a", 0, 5000, "scene-voice"],
      ["b", 5000, 6346, "estimate"],
    ]);
  });

  it("falls back to estimates when manual durations exceed the project voice", () => {
    const p = project({
      voiceAssetId: "voice",
      assets: [asset("voice", "audio", { durationMs: 3000 })],
      scenes: [scene("a", "x", { durationMs: 5000 }), scene("b", "Xin chào")],
    });
    expect(spans(p)).toEqual([
      ["a", 0, 5000, "manual"],
      ["b", 5000, 6200, "estimate"],
    ]);
  });

  it("estimates when voice durations are unknown or the voice asset is missing", () => {
    const p = project({
      voiceAssetId: "voice",
      assets: [asset("voice", "audio"), asset("sv", "audio", { durationMs: 0 })],
      voiceTrack: "scenes",
      scenes: [scene("a", "Xin chào", { voiceAssetId: "sv" }), scene("b", "Chào", { voiceAssetId: "gone" })],
    });
    expect(spans(p)).toEqual([
      ["a", 0, 1200, "estimate"],
      ["b", 1200, 2400, "estimate"],
    ]);
  });

  it("gives a voice shorter than the scene count to estimates instead of zero-length scenes", () => {
    const p = project({
      voiceAssetId: "voice",
      assets: [asset("voice", "audio", { durationMs: 1 })],
      scenes: [scene("a", "Xin chào"), scene("b", "Chào")],
    });
    expect(computeTimeline(p).every((entry) => entry.source === "estimate")).toBe(true);
  });

  it("chains start times across all scenes", () => {
    const p = project({
      scenes: [scene("a", "x", { durationMs: 1000 }), scene("b", "y", { durationMs: 2500 })],
    });
    expect(computeTimeline(p)[1]).toMatchObject({ index: 1, startMs: 1000, endMs: 3500, durationMs: 2500 });
  });
});

describe("chunkNarration", () => {
  it("cuts at the word limit", () => {
    expect(chunkNarration("Một hai ba bốn năm sáu bảy tám", 6)).toEqual([
      "Một hai ba bốn năm sáu",
      "bảy tám",
    ]);
  });

  it("cuts at sentence ends", () => {
    expect(chunkNarration("Xin chào. Bạn khỏe không?", 6)).toEqual(["Xin chào.", "Bạn khỏe không?"]);
    expect(chunkNarration('Anh nói "được." Rồi đi', 6)).toEqual(['Anh nói "được."', "Rồi đi"]);
  });

  it("cuts at a comma only once the caption is 60% full", () => {
    expect(chunkNarration("a b c d e f, g h i j k l", 10)).toEqual(["a b c d e f,", "g h i j k l"]);
    expect(chunkNarration("a b, c d", 10)).toEqual(["a b, c d"]);
  });

  it("merges a single trailing word into the previous caption", () => {
    expect(chunkNarration("a b c d e f g", 6)).toEqual(["a b c d e f g"]);
    expect(chunkNarration("Một hai ba. Bốn", 6)).toEqual(["Một hai ba. Bốn"]);
    expect(chunkNarration(" Chào ", 6)).toEqual(["Chào"]);
  });

  it("returns nothing for empty narration", () => {
    expect(chunkNarration("  ", 6)).toEqual([]);
  });
});

describe("buildCaptions", () => {
  const p = project({
    scenes: [
      scene("a", "Một hai ba bốn năm sáu bảy tám", { durationMs: 3000 }),
      scene("b", "", { durationMs: 1000 }),
      scene("c", "Chào.", { durationMs: 2000 }),
    ],
  });

  it("times captions by weight and ends each scene's last caption with the scene", () => {
    expect(buildCaptions(p)).toEqual([
      { sceneId: "a", index: 0, text: "Một hai ba bốn năm sáu", startMs: 0, endMs: 2250 },
      { sceneId: "a", index: 1, text: "bảy tám", startMs: 2250, endMs: 3000 },
      { sceneId: "c", index: 2, text: "Chào.", startMs: 4000, endMs: 6000 },
    ]);
  });

  it("accepts a precomputed timeline and skips scenes it does not cover", () => {
    expect(buildCaptions(p, computeTimeline(p).slice(0, 1))).toHaveLength(2);
  });

  it("is empty for a project without scenes", () => {
    expect(buildCaptions(project())).toEqual([]);
  });
});

describe("captionsToSrt", () => {
  it("formats numbered cues with HH:MM:SS,mmm", () => {
    const srt = captionsToSrt([
      { sceneId: "a", index: 0, text: "Xin chào", startMs: 0, endMs: 1234 },
      { sceneId: "a", index: 1, text: "Tạm biệt", startMs: 3_723_004, endMs: 3_724_000 },
    ]);
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:01,234\nXin chào\n\n2\n01:02:03,004 --> 01:02:04,000\nTạm biệt\n",
    );
  });

  it("is empty without captions", () => {
    expect(captionsToSrt([])).toBe("");
  });
});
