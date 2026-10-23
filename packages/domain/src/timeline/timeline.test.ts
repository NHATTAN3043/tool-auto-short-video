import { describe, expect, it } from "vitest";

import type { Project } from "../project/schema";
import { asset, project, scene } from "../testing/fixtures";
import { buildCaptions, captionsToSrt, chunkNarration } from "./captions";
import { computeTimeline, timelineDurationMs } from "./compute-timeline";
import { scenePauseMs } from "./scene-pause";

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
    // The scene voice is followed by the default 0.3s pause; the manual scene gets none.
    expect(spans(p)).toEqual([
      ["a", 0, 2000, "manual"],
      ["b", 2000, 7300, "scene-voice"],
      ["c", 7300, 8500, "estimate"],
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
      ["a", 0, 5300, "scene-voice"],
      ["b", 5300, 6646, "estimate"],
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

describe("scene pause", () => {
  const voiced = (style: Partial<Project["style"]>) =>
    project({
      assets: [asset("sv", "audio", { durationMs: 2000 })],
      style: { ...project().style, ...style },
      scenes: [
        scene("a", "Mèo ngủ rất nhiều,", { voiceAssetId: "sv" }),
        scene("b", "để giữ sức đi săn.", { voiceAssetId: "sv" }),
        scene("c", "Bất kỳ.", { voiceAssetId: "sv", durationMs: 1500 }),
      ],
    });

  it("adds the full pause after a sentence and two thirds mid-sentence, never to manual scenes", () => {
    const timeline = computeTimeline(voiced({ scenePauseMs: 300 }));
    expect(timeline.map(({ startMs, endMs, pauseMs }) => [startMs, endMs, pauseMs])).toEqual([
      [0, 2200, 200],
      [2200, 4500, 300],
      [4500, 6000, undefined],
    ]);
  });

  it("keeps scenes as long as their voice when the pause is off or absent", () => {
    const off = voiced({ scenePauseMs: 0 });
    const absent = { ...off.style };
    delete absent.scenePauseMs;
    for (const p of [off, { ...off, style: absent }]) {
      expect(computeTimeline(p).map((entry) => [entry.endMs, "pauseMs" in entry])).toEqual([
        [2000, false],
        [4000, false],
        [5500, false],
      ]);
    }
  });

  it("times captions over the voice and holds the last caption through the pause", () => {
    const p = voiced({ scenePauseMs: 300, captions: { ...project().style.captions, maxWordsPerCaption: 2 } });
    const sceneB = buildCaptions(p).filter((caption) => caption.sceneId === "b");
    expect(sceneB.map(({ text, startMs, endMs }) => [text, startMs, endMs])).toEqual([
      // The lone last word joins the caption before it; weights 2 and 4.5 share the 2s of voice.
      ["để giữ", 2200, 2815],
      ["sức đi săn.", 2815, 4500],
    ]);
  });
});

describe("scenePauseMs", () => {
  it.each([
    ["Xong rồi.", 300, 300],
    ["Thật sao?”", 300, 300],
    ["Còn nữa,", 300, 200],
    ["Không dấu", 450, 300],
    ["Xong rồi.", 0, 0],
  ])("%s with %ims → %ims", (narration, base, expected) => {
    expect(scenePauseMs(narration, base)).toBe(expected);
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
