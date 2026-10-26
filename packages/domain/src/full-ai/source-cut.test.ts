import { describe, expect, it } from "vitest";

import type { SourceCutRequest } from "../ai/schema";
import type { ClipAnalysis } from "../media/clip-analysis";
import { MODE_PRESETS } from "../project/presets";
import { asset, project, scene, sequentialIds } from "../testing/fixtures";
import { assertFullAiRequest, fullAiSteps, isPaidFullAiStep } from "./plan";
import type { FullAiRequest } from "./schema";
import { applySourceCut, fitSourceScenes, normalizeSourceCut, sourceCutShots } from "./source-cut";

const analysis: ClipAnalysis = {
  model: "test",
  analyzedAt: "2026-10-26T00:00:00.000Z",
  shots: [
    { index: 0, startMs: 0, endMs: 4000, description: "Mèo ngủ", tags: [], textOverlay: false },
    { index: 1, startMs: 4000, endMs: 9000, description: "Mèo thức dậy", tags: [], textOverlay: false },
    { index: 2, startMs: 9000, endMs: 15000, description: "Mèo ăn", tags: [], textOverlay: true },
    { index: 3, startMs: 15000, endMs: 20000, description: "Mèo chạy", tags: [], textOverlay: false },
  ],
};

const request: SourceCutRequest = {
  idea: "Một ngày của mèo",
  targetDurationSec: 10,
  durationMs: 20_000,
  shots: sourceCutShots(analysis),
};

const video = asset("vid", "video", { durationMs: 20_000, contentHash: "sha256:abc" });
const intro = asset("intro", "video", { durationMs: 3000, fileName: "intro.mp4" });
const logo = asset("logo", "image", { fileName: "logo.png" });
const words = (count: number) => Array.from({ length: count }, () => "chữ").join(" ");
const refused: unknown = expect.objectContaining({ code: "AI_INVALID_OUTPUT" });

describe("normalizeSourceCut", () => {
  it("keeps the main part as runs of shots in order, with the hook and ending asked for", () => {
    const cut = normalizeSourceCut(
      {
        title: " Mèo ",
        hook: { narration: "Con mèo này  lạ lắm!", fromShot: 2, toShot: 2 },
        main: [{ fromShot: 0, toShot: 3, narration: "Mèo ngủ, dậy, ăn rồi chạy." }],
        outro: { narration: "Theo dõi nhé." },
      },
      { ...request, hook: { kind: "source" }, outro: { kind: "clip", durationMs: 3000 } },
    );
    expect(cut.title).toBe("Mèo");
    expect(cut.parts).toEqual([
      {
        role: "hook",
        narration: "Con mèo này lạ lắm!",
        fromShot: 2,
        toShot: 2,
        startMs: 9000,
        endMs: 15_000,
      },
      {
        role: "main",
        narration: "Mèo ngủ, dậy, ăn rồi chạy.",
        fromShot: 0,
        toShot: 3,
        startMs: 0,
        endMs: 20_000,
      },
      { role: "outro", narration: "Theo dõi nhé." },
    ]);
  });

  it("refuses main runs out of order, overlapping or past the last shot", () => {
    const refuse = (main: { fromShot: number; toShot: number }[]) => {
      expect(() =>
        normalizeSourceCut({ title: "", main: main.map((run) => ({ ...run, narration: "Lời." })) }, request),
      ).toThrow(refused);
    };
    refuse([
      { fromShot: 2, toShot: 3 },
      { fromShot: 0, toShot: 1 },
    ]);
    refuse([
      { fromShot: 0, toShot: 2 },
      { fromShot: 2, toShot: 3 },
    ]);
    refuse([{ fromShot: 1, toShot: 0 }]);
    refuse([{ fromShot: 3, toShot: 4 }]);
  });

  it("needs the hook and ending it asked for, with words and, from the source, valid shots", () => {
    const main = [{ fromShot: 0, toShot: 3, narration: "Lời chính." }];
    const asked: SourceCutRequest = { ...request, hook: { kind: "source" }, outro: { kind: "clip" } };
    expect(() => normalizeSourceCut({ title: "", main, outro: { narration: "Hết." } }, asked)).toThrow(
      refused,
    );
    expect(() =>
      normalizeSourceCut(
        { title: "", main, hook: { narration: "Xem!" }, outro: { narration: "Hết." } },
        asked,
      ),
    ).toThrow(refused);
    expect(() =>
      normalizeSourceCut(
        { title: "", main, hook: { narration: "Xem!", fromShot: 0, toShot: 0 }, outro: { narration: " " } },
        asked,
      ),
    ).toThrow(refused);
    // Not asked for: dropped.
    expect(normalizeSourceCut({ title: "", main, hook: { narration: "Xem!" } }, request).parts).toHaveLength(
      1,
    );
  });

  it("keeps the user's narration in the main part: words may be left out, never changed", () => {
    const text = "Mèo ngủ say. Rồi mèo dậy, đi ăn sáng.";
    const answer = (narration: string) => ({ title: "", main: [{ fromShot: 0, toShot: 2, narration }] });
    const keep: SourceCutRequest = { ...request, script: { text, role: "narration" } };
    expect(normalizeSourceCut(answer("mèo ngủ say rồi mèo dậy!"), keep).parts).toHaveLength(1);
    expect(() => normalizeSourceCut(answer("Mèo ngủ ngon."), keep)).toThrow(refused);
    const reference: SourceCutRequest = { ...request, script: { text, role: "reference" } };
    expect(normalizeSourceCut(answer("Mèo ngủ ngon."), reference).parts).toHaveLength(1);
  });

  it("warns when the narration misses the target or cannot fit its video even at the speed limits", () => {
    const cut = normalizeSourceCut(
      { title: "", main: [{ fromShot: 0, toShot: 0, narration: words(60) }] },
      request,
    );
    expect(cut.warnings).toEqual([
      expect.stringContaining("Lời đọc ước tính"),
      expect.stringContaining("Phần chính 1: lời đọc"),
    ]);
  });
});

describe("applySourceCut", () => {
  it("makes hook, one long main scene and ending, with the user's clip and image", () => {
    const cut = normalizeSourceCut(
      {
        title: "",
        hook: { narration: "Xem này!" },
        main: [{ fromShot: 1, toShot: 3, narration: "Mèo dậy, ăn rồi chạy." }],
        outro: { narration: "Theo dõi nhé." },
      },
      { ...request, hook: { kind: "clip", durationMs: 3000 }, outro: { kind: "clip" } },
    );
    const next = applySourceCut(
      project({ assets: [video, intro, logo], scenes: [scene("old", "Cũ.")] }),
      cut,
      analysis,
      {
        assetId: "vid",
        volume: 0.3,
        hook: { kind: "asset", assetId: "intro" },
        outro: { kind: "asset", assetId: "logo" },
      },
      { newId: sequentialIds() },
    );
    expect(next.script).toBe("Xem này!\n\nMèo dậy, ăn rồi chạy.\n\nTheo dõi nhé.");
    expect(next.scenes.map((s) => [s.media?.assetId, s.media?.sourceStartMs, s.media?.sourceEndMs])).toEqual([
      ["intro", 0, undefined],
      ["vid", 4000, 20_000],
      ["logo", 0, undefined],
    ]);
    expect(next.scenes[1]?.media?.volume).toBe(0.3);
    expect(next.scenes[1]?.visualPlan?.intent).toBe("Mèo thức dậy · Mèo ăn · Mèo chạy");
    expect(next.scenes[0]?.visualPlan?.intent).toBe("Mở đầu: intro.mp4");
    expect(next.scenes[2]?.media?.kenBurns).toBe(true);
    expect(next.scenes.every((s) => s.durationMs === undefined)).toBe(true);
  });

  it("keeps a stretch inside a source probed a little shorter than the analysis", () => {
    const cut = normalizeSourceCut(
      { title: "", main: [{ fromShot: 2, toShot: 3, narration: "Mèo ăn." }] },
      request,
    );
    const short = { ...video, durationMs: 19_500 };
    const next = applySourceCut(project({ assets: [short] }), cut, analysis, { assetId: "vid", volume: 0 });
    expect(next.scenes[0]?.media?.sourceEndMs).toBe(19_500);
  });
});

describe("fitSourceScenes", () => {
  const voice = (id: string, durationMs: number) => asset(id, "audio", { durationMs });
  const withMedia = (id: string, voiceAssetId: string | undefined, sourceEndMs: number) =>
    scene(id, "Lời.", {
      ...(voiceAssetId !== undefined && { voiceAssetId }),
      media: {
        assetId: "vid",
        sourceStartMs: 0,
        sourceEndMs,
        fit: "cover",
        focusX: 0.5,
        volume: 0,
        kenBurns: false,
      },
    });

  it("speeds each video up or down to end with its voice, within 0.8–1.25×", () => {
    const p = project({
      assets: [video, voice("v1", 10_000), voice("v2", 4000)],
      scenes: [withMedia("a", "v1", 11_000), withMedia("b", "v2", 20_000), withMedia("c", undefined, 6000)],
    });
    const { project: next, warnings } = fitSourceScenes({ ...p, style: { ...p.style, scenePauseMs: 0 } });
    expect(next.scenes.map((s) => [s.media?.playbackRate, s.durationMs])).toEqual([
      [1.1, 10_000],
      [1.25, 16_000],
      [undefined, 6000],
    ]);
    expect(warnings).toEqual([expect.stringContaining("Cảnh 2: video dài hơn giọng")]);
  });

  it("counts the scene pause after the voice", () => {
    const p = project({ assets: [video, voice("v1", 10_000)], scenes: [withMedia("a", "v1", 11_000)] });
    const { project: next } = fitSourceScenes({ ...p, style: { ...p.style, scenePauseMs: 1000 } });
    expect(next.scenes[0]).toMatchObject({ durationMs: 11_000 });
    expect(next.scenes[0]?.media?.playbackRate).toBeUndefined();
  });

  it("warns when the voice outruns the video even slowed down", () => {
    const { project: next, warnings } = fitSourceScenes(
      project({ assets: [video, voice("v1", 10_000)], scenes: [withMedia("a", "v1", 5000)] }),
    );
    expect(next.scenes[0]).toMatchObject({ durationMs: 6250, media: { playbackRate: 0.8 } });
    expect(warnings).toEqual([expect.stringContaining("Cảnh 1: giọng dài hơn video")]);
  });
});

describe("Full AI on a source video", () => {
  const base: FullAiRequest = {
    idea: "Một ngày của mèo",
    targetDurationSec: 15,
    rankingMode: "text",
    sourceVideo: { assetId: "vid", volume: 0 },
    replaceScenes: false,
  };

  it("analyzes when needed, cuts, then voices; never searches media", () => {
    expect(fullAiSteps(MODE_PRESETS.full_ai, { tts: true }, undefined, { analyzed: false })).toEqual([
      "analyze",
      "cut",
      "voice",
    ]);
    expect(fullAiSteps(MODE_PRESETS.manual, { tts: true }, undefined, { analyzed: true })).toEqual(["cut"]);
    expect(isPaidFullAiStep("analyze", MODE_PRESETS.manual)).toBe(true);
    expect(isPaidFullAiStep("cut", MODE_PRESETS.manual)).toBe(true);
  });

  it("takes a target longer than the video, and needs an idea or a script and existing clips", () => {
    const ok = project({ assets: [video, intro] });
    const check =
      (request: FullAiRequest, target = ok) =>
      () => {
        assertFullAiRequest(target, request, ["cut"]);
      };
    expect(check({ ...base, targetDurationSec: 60 })).not.toThrow();
    expect(check({ ...base, idea: "" })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(
      check({
        ...base,
        idea: "",
        sourceVideo: { assetId: "vid", volume: 0, script: { text: "Lời.", role: "narration" } },
      }),
    ).not.toThrow();
    expect(
      check({
        ...base,
        sourceVideo: { assetId: "vid", volume: 0, hook: { kind: "asset", assetId: "intro" } },
      }),
    ).not.toThrow();
    expect(
      check({
        ...base,
        sourceVideo: { assetId: "vid", volume: 0, outro: { kind: "asset", assetId: "gone" } },
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_MEDIA" }));
    expect(check(base, project({ assets: [{ ...video, contentHash: undefined }] }))).toThrow(
      expect.objectContaining({ code: "INVALID_MEDIA" }),
    );
  });
});
