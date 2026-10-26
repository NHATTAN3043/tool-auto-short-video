import { describe, expect, it } from "vitest";

import { asset, project, scene } from "../testing/fixtures";
import { buildRenderPlan } from "../render-plan/build-render-plan";
import { computeTimeline } from "../timeline/compute-timeline";
import { fitMediaToVoice, fitSceneToVoice, setMediaPlaybackRate } from "./fit-speed";

const setup = () =>
  project({
    assets: [asset("v", "video", { durationMs: 20_000 }), asset("voice", "audio", { durationMs: 9000 })],
    scenes: [
      scene("a", "Lời đọc giữ nguyên", {
        durationMs: 10_000,
        voiceAssetId: "voice",
        media: {
          assetId: "v",
          sourceStartMs: 2000,
          sourceEndMs: 12_000,
          fit: "contain",
          focusX: 0.5,
          volume: 0.2,
          kenBurns: false,
        },
      }),
      scene("b", "Cảnh khác"),
    ],
  });

describe("manual media playback speed", () => {
  it.each([0.5, 1, 1.25, 2])("%s× preserves a 10s scene, trims, voice and other scenes", (rate) => {
    const before = setup();
    const next = setMediaPlaybackRate(before, "a", rate);
    expect(next.scenes[0]).toEqual({
      ...before.scenes[0],
      media: { ...before.scenes[0]?.media, ...(rate !== 1 && { playbackRate: rate }) },
    });
    expect(next.scenes[1]).toBe(before.scenes[1]);
    expect(next.assets).toBe(before.assets);
    expect(next.scenes[0]?.durationMs).toBe(10_000);
    const rendered = buildRenderPlan(
      { ...next, style: { ...next.style, transition: "none" } },
      (a) => `/files/${a.path}`,
    ).scenes[0];
    expect(rendered?.durationInFrames).toBe(300);
    expect(rendered?.media).toMatchObject({
      startFrom: 60,
      segmentFrames: 300,
      playbackRate: rate,
      playedFrames: Math.floor(300 / rate),
      loop: rate > 1,
    });
  });

  it("uses the end of the source when no end trim is set and resets normal speed", () => {
    const before = setup();
    delete before.scenes[0]?.media?.sourceEndMs;
    const fast = setMediaPlaybackRate(before, "a", 2);
    expect(fast.scenes[0]?.durationMs).toBe(10_000);
    const normal = setMediaPlaybackRate(fast, "a", 1);
    expect(normal.scenes[0]?.durationMs).toBe(10_000);
    expect(normal.scenes[0]?.media?.playbackRate).toBeUndefined();
  });

  it.each([0, 0.49, 2.01, NaN, Infinity])("rejects invalid speed %s without mutating the project", (rate) => {
    const before = setup();
    expect(() => setMediaPlaybackRate(before, "a", rate)).toThrow();
    expect(before.scenes[0]?.media?.playbackRate).toBeUndefined();
  });

  it("rejects a missing scene or image but allows unknown source length", () => {
    const before = setup();
    expect(() => setMediaPlaybackRate(before, "missing", 1)).toThrow();
    expect(() => setMediaPlaybackRate(before, "b", 1)).toThrow();
    const first = before.scenes[0];
    if (!first?.media) throw new Error("Missing fixture");
    delete first.media.sourceEndMs;
    const source = before.assets[0];
    if (!source) throw new Error("Missing fixture");
    delete source.durationMs;
    expect(setMediaPlaybackRate(before, "a", 2).scenes[0]).toMatchObject({
      durationMs: 10_000,
      media: { playbackRate: 2 },
    });
    expect(() => fitMediaToVoice(before, "a")).toThrow();
    source.kind = "image";
    expect(() => setMediaPlaybackRate(before, "a", 1)).toThrow();
  });

  it("keeps automatic duration and scenes sharing the same asset unchanged", () => {
    const before = setup();
    const first = before.scenes[0];
    if (!first?.media) throw new Error("Missing fixture");
    delete first.durationMs;
    before.scenes[1] = { ...first, id: "b" };
    const next = setMediaPlaybackRate(before, "a", 2);
    expect(next.scenes[0]?.durationMs).toBeUndefined();
    expect(computeTimeline(next)).toEqual(computeTimeline(before));
    expect(next.scenes[1]).toBe(before.scenes[1]);
    expect(next.scenes[1]?.media?.playbackRate).toBeUndefined();
  });

  it("manual voice fit changes speed only while Full AI still fits scene duration", () => {
    const before = setup();
    const manual = fitMediaToVoice(before, "a");
    const automatic = fitSceneToVoice(before, "a");
    expect(manual.scenes[0]?.media?.playbackRate).toBe(automatic.fit.playbackRate);
    expect(manual.scenes[0]?.durationMs).toBe(10_000);
    expect(automatic.project.scenes[0]?.durationMs).toBe(automatic.fit.durationMs);
    expect(automatic.fit.durationMs).not.toBe(10_000);
    expect(() => fitMediaToVoice(before, "b")).toThrow();
    delete before.scenes[0]?.voiceAssetId;
    expect(() => fitMediaToVoice(before, "a")).toThrow();
  });
});
