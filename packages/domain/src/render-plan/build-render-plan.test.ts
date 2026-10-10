import { describe, expect, it, vi } from "vitest";

import type { MediaAsset } from "../media/schema";
import type { Project } from "../project/schema";
import { asset, project, scene } from "../testing/fixtures";
import { buildRenderPlan } from "./build-render-plan";

const resolveUrl = (a: MediaAsset) => `/files/${a.path}`;
const cover = { fit: "cover" as const, focusX: 0.5, volume: 0, kenBurns: false };

function demo(): Project {
  return project({
    voiceAssetId: "voice",
    music: { assetId: "music", volume: 0.12 },
    assets: [
      asset("vid1", "video", { durationMs: 30_000 }),
      asset("img", "image"),
      asset("short", "video", { durationMs: 2000 }),
      asset("voice", "audio", { durationMs: 4000 }),
      asset("sv", "audio", { durationMs: 1500 }),
      asset("music", "audio", { durationMs: 60_000 }),
    ],
    scenes: [
      scene("a", "Xin chào các bạn", {
        durationMs: 3333,
        media: { ...cover, assetId: "vid1", sourceStartMs: 3200, sourceEndMs: 9500 },
      }),
      scene("b", "Ảnh", {
        durationMs: 2000,
        media: { ...cover, assetId: "img", sourceStartMs: 0, kenBurns: true },
      }),
      scene("c", "Không media", { durationMs: 1500, voiceAssetId: "sv" }),
      scene("d", "Video ngắn", { durationMs: 5000, media: { ...cover, assetId: "short", sourceStartMs: 0 } }),
    ],
  });
}

describe("buildRenderPlan", () => {
  it("lays scenes out on contiguous rounded frame boundaries", () => {
    const plan = buildRenderPlan(demo(), resolveUrl);
    // ends at 3333, 5333, 6833, 11833 ms → frames 100, 160, 205, 355
    expect(plan.scenes.map((s) => [s.sceneId, s.from, s.durationInFrames])).toEqual([
      ["a", 0, 100],
      ["b", 100, 60],
      ["c", 160, 45],
      ["d", 205, 150],
    ]);
    expect(plan.durationInFrames).toBe(355);
    expect(plan.scenes.reduce((sum, s) => sum + s.durationInFrames, 0)).toBe(plan.durationInFrames);
    expect(plan).toMatchObject({ width: 1080, height: 1920, fps: 30, background: "#000000" });
  });

  it("extends every scene but the last by the fade so transitions overlap instead of shortening", () => {
    const plan = buildRenderPlan(demo(), resolveUrl);
    expect(plan.transitionFrames).toBe(8); // 250ms
    expect(plan.scenes.map((s) => s.sequenceDurationInFrames)).toEqual([108, 68, 53, 150]);

    const noFade = { ...demo(), style: { ...demo().style, transition: "none" as const } };
    const plain = buildRenderPlan(noFade, resolveUrl);
    expect(plain.transitionFrames).toBe(0);
    expect(plain.scenes.map((s) => s.sequenceDurationInFrames)).toEqual([100, 60, 45, 150]);
  });

  it("converts the chosen source segment to frames", () => {
    const [a, b, c, d] = buildRenderPlan(demo(), resolveUrl).scenes;
    expect(a?.media).toEqual({
      kind: "video",
      src: "/files/media/vid1.bin",
      fit: "cover",
      focusX: 0.5,
      volume: 0,
      startFrom: 96,
      segmentFrames: 189,
      loop: false,
    });
    expect(b?.media).toEqual({
      kind: "image",
      src: "/files/media/img.bin",
      fit: "cover",
      focusX: 0.5,
      kenBurns: true,
    });
    expect(c?.media).toBeUndefined();
    expect(c?.durationSource).toBe("manual");
    // a 2s clip on a 5s scene runs to the end of the file and loops
    expect(d?.media).toMatchObject({ startFrom: 0, segmentFrames: 60, loop: true });
  });

  it("plays a video of unknown length straight through", () => {
    const p = project({
      assets: [asset("v", "video")],
      scenes: [scene("a", "x", { durationMs: 2000, media: { ...cover, assetId: "v", sourceStartMs: 1000 } })],
    });
    expect(buildRenderPlan(p, resolveUrl).scenes[0]?.media).toMatchObject({
      startFrom: 30,
      segmentFrames: 60,
      loop: false,
    });
  });

  it("plays only the project voice by default when scene voices exist too, and music", () => {
    const plan = buildRenderPlan(demo(), resolveUrl);
    expect(plan.voices).toEqual([{ src: "/files/media/voice.bin", from: 0, durationInFrames: 120 }]);
    expect(plan.music).toEqual({ src: "/files/media/music.bin", volume: 0.12 });
  });

  it("plays only the scene voices when that track is chosen", () => {
    const plan = buildRenderPlan({ ...demo(), voiceTrack: "scenes" }, resolveUrl);
    expect(plan.voices).toEqual([{ src: "/files/media/sv.bin", from: 160, durationInFrames: 45 }]);
  });

  it("clips a project voice longer than the video", () => {
    const p = { ...demo(), scenes: demo().scenes.slice(0, 1) };
    expect(buildRenderPlan(p, resolveUrl).voices[0]?.durationInFrames).toBe(100);
  });

  it("resolves every used asset through resolveUrl", () => {
    const spy = vi.fn(resolveUrl);
    buildRenderPlan(demo(), spy);
    expect(spy.mock.calls.map(([a]) => a.id).sort()).toEqual(["img", "music", "short", "vid1", "voice"]);
  });

  it("builds frame-based captions and applies uppercase", () => {
    const base = demo();
    const plan = buildRenderPlan(base, resolveUrl);
    expect(plan.captions[0]).toEqual({ text: "Xin chào các bạn", from: 0, durationInFrames: 100 });
    expect(plan.captionStyle).toEqual(base.style.captions);

    const upper = {
      ...base,
      style: { ...base.style, captions: { ...base.style.captions, uppercase: true } },
    };
    expect(buildRenderPlan(upper, resolveUrl).captions[0]?.text).toBe("XIN CHÀO CÁC BẠN");

    const off = { ...base, style: { ...base.style, captions: { ...base.style.captions, enabled: false } } };
    expect(buildRenderPlan(off, resolveUrl).captions).toEqual([]);
  });

  it("returns an empty plan for a project without scenes", () => {
    const plan = buildRenderPlan(project(), resolveUrl);
    expect(plan).toMatchObject({ durationInFrames: 0, scenes: [], voices: [], captions: [] });
    expect(plan.music).toBeUndefined();
  });

  it("never produces an empty sequence", () => {
    const p = project({ scenes: [scene("a", "x", { durationMs: 1 }), scene("b", "y", { durationMs: 1 })] });
    expect(buildRenderPlan(p, resolveUrl).scenes.map((s) => [s.from, s.durationInFrames])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it("rejects missing or wrong-kind assets", () => {
    const missing = { ...demo(), music: { assetId: "gone", volume: 0.1 } };
    expect(() => buildRenderPlan(missing, resolveUrl)).toThrow(
      expect.objectContaining({ code: "ASSET_NOT_FOUND" }),
    );
    const wrongKind = { ...demo(), voiceAssetId: "vid1" };
    expect(() => buildRenderPlan(wrongKind, resolveUrl)).toThrow(
      expect.objectContaining({ code: "INVALID_MEDIA" }),
    );
  });
});
