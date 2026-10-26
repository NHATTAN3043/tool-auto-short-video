import { describe, expect, it } from "vitest";

import { DEFAULT_CAPTION_STYLE } from "../project/presets";
import { ALL_LAYERS, filterRenderPlan, hasAudibleAudio } from "./filter-render-plan";
import type { RenderPlan } from "./types";

function plan(): RenderPlan {
  return {
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 90,
    transitionFrames: 0,
    background: "#000000",
    scenes: [
      {
        sceneId: "a",
        index: 0,
        from: 0,
        durationInFrames: 90,
        sequenceDurationInFrames: 90,
        durationSource: "manual",
        media: {
          kind: "video",
          src: "v.mp4",
          fit: "cover",
          focusX: 0.5,
          volume: 0.3,
          startFrom: 0,
          segmentFrames: 90,
          playbackRate: 1,
          playedFrames: 90,
          loop: false,
        },
      },
    ],
    voices: [{ src: "voice.mp3", from: 0, durationInFrames: 90 }],
    music: { src: "music.mp3", volume: 0.1 },
    sfx: [{ src: "pop.mp3", from: 30, durationInFrames: 10, volume: 1 }],
    captions: [{ text: "XIN CHÀO", from: 0, durationInFrames: 30 }],
    captionStyle: { ...DEFAULT_CAPTION_STYLE },
    watermark: {
      src: "logo.png",
      left: 43,
      top: 134,
      diameter: 130,
      opacity: 0.9,
      borderWidth: 4,
      borderColor: "#FFFFFF",
    },
  };
}

const none = { visuals: false, captions: false, voices: false, music: false, sfx: false, watermark: false };

describe("filterRenderPlan", () => {
  it("keeps everything with all layers on", () => {
    expect(filterRenderPlan(plan(), ALL_LAYERS)).toEqual(plan());
  });

  it("drops the switched-off layers but keeps scene timing", () => {
    const visualsOnly = filterRenderPlan(plan(), { ...none, visuals: true });
    expect(visualsOnly.scenes).toEqual(plan().scenes);
    expect(visualsOnly).toMatchObject({ captions: [], voices: [], sfx: [], durationInFrames: 90 });
    expect(visualsOnly).not.toHaveProperty("music");
    expect(visualsOnly).not.toHaveProperty("watermark");
    expect(filterRenderPlan(plan(), { ...none, visuals: true, watermark: true }).watermark).toEqual(
      plan().watermark,
    );

    const voiceOnly = filterRenderPlan(plan(), { ...none, voices: true });
    expect(voiceOnly.scenes[0]).not.toHaveProperty("media");
    expect(voiceOnly.scenes[0]?.durationInFrames).toBe(90);
    expect(voiceOnly.voices).toHaveLength(1);
  });

  it("tells whether a filtered plan has anything to hear", () => {
    expect(hasAudibleAudio(filterRenderPlan(plan(), none))).toBe(false);
    expect(hasAudibleAudio(filterRenderPlan(plan(), { ...none, visuals: true }))).toBe(true);
    expect(hasAudibleAudio(filterRenderPlan(plan(), { ...none, music: true }))).toBe(true);
    expect(hasAudibleAudio(filterRenderPlan(plan(), { ...none, sfx: true }))).toBe(true);
  });
});
