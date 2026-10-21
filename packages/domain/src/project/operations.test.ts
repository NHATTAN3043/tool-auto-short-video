import { describe, expect, it } from "vitest";

import { asset, project } from "../testing/fixtures";
import { withProjectLanguage } from "../ai/apply";
import {
  projectLanguage,
  setMusic,
  setProjectLanguage,
  setProjectVoice,
  updateStyle,
  watermarkAssetId,
} from "./operations";
import { DEFAULT_WATERMARK, WATERMARK_SAFE_OFFSETS } from "./presets";
import { ProjectSchema } from "./schema";

const withAssets = () =>
  project({ assets: [asset("voice", "audio"), asset("song", "audio"), asset("clip", "video")] });

describe("setProjectVoice", () => {
  it("sets and clears the project voice without mutating the input", () => {
    const original = withAssets();
    const set = setProjectVoice(original, "voice");
    expect(set.voiceAssetId).toBe("voice");
    expect(original.voiceAssetId).toBeUndefined();
    expect("voiceAssetId" in setProjectVoice(set, null)).toBe(false);
  });

  it("rejects unknown and non-audio assets", () => {
    expect(() => setProjectVoice(withAssets(), "nope")).toThrow(
      expect.objectContaining({ code: "ASSET_NOT_FOUND" }),
    );
    expect(() => setProjectVoice(withAssets(), "clip")).toThrow(
      expect.objectContaining({ code: "INVALID_MEDIA" }),
    );
  });
});

describe("setMusic", () => {
  it("sets, changes and clears background music", () => {
    const set = setMusic(withAssets(), { assetId: "song", volume: 0.2 });
    expect(set.music).toEqual({ assetId: "song", volume: 0.2 });
    expect(setMusic(set, { assetId: "song", volume: 0.5 }).music?.volume).toBe(0.5);
    expect("music" in setMusic(set, null)).toBe(false);
  });

  it("rejects non-audio assets and out-of-range volume", () => {
    expect(() => setMusic(withAssets(), { assetId: "clip", volume: 0.1 })).toThrow(
      expect.objectContaining({ code: "INVALID_MEDIA" }),
    );
    for (const volume of [-0.1, 1.5, Number.NaN]) {
      expect(() => setMusic(withAssets(), { assetId: "song", volume })).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    }
  });
});

describe("updateStyle", () => {
  it("merges caption and transition changes without mutating the input", () => {
    const original = project();
    const next = updateStyle(original, {
      captions: { fontSize: 80, uppercase: true },
      transition: "fade",
      transitionMs: 300,
    });
    expect(next.style).toEqual({
      ...original.style,
      transition: "fade",
      transitionMs: 300,
      captions: { ...original.style.captions, fontSize: 80, uppercase: true },
    });
    expect(original.style.captions.fontSize).not.toBe(80);
  });

  it.each([
    ["a position outside the frame", { captions: { positionY: 1.2 } }],
    ["a zero font size", { captions: { fontSize: 0 } }],
    ["zero words per caption", { captions: { maxWordsPerCaption: 0 } }],
    ["a negative transition", { transitionMs: -1 }],
  ])("rejects %s", (_label, patch) => {
    expect(() => updateStyle(project(), patch)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});

describe("updateStyle watermark", () => {
  const withLogo = () =>
    project({ assets: [asset("logo", "image"), asset("logo2", "image"), asset("clip", "video")] });

  it("adds a logo with the top-left defaults and removes it with null", () => {
    const added = updateStyle(withLogo(), { watermark: { assetId: "logo" } });
    expect(added.style.watermark).toEqual({ ...DEFAULT_WATERMARK, assetId: "logo" });
    expect(added.style.watermark?.corner).toBe("top-left");
    expect(watermarkAssetId(added)).toBe("logo");

    const removed = updateStyle(added, { watermark: null });
    expect(removed.style).not.toHaveProperty("watermark");
    expect(ProjectSchema.safeParse(removed).success).toBe(true);
  });

  it("keeps the logo when only captions change", () => {
    const added = updateStyle(withLogo(), { watermark: { assetId: "logo", opacity: 0.5 } });
    expect(updateStyle(added, { captions: { fontSize: 70 } }).style.watermark).toEqual(added.style.watermark);
  });

  it("takes the safe offsets of a new corner unless offsets are given", () => {
    const added = updateStyle(withLogo(), { watermark: { assetId: "logo", offsetY: 0.1 } });
    const moved = updateStyle(added, { watermark: { corner: "bottom-right" } });
    expect(moved.style.watermark).toMatchObject({
      corner: "bottom-right",
      ...WATERMARK_SAFE_OFFSETS["bottom-right"],
    });
    const nudged = updateStyle(added, { watermark: { corner: "bottom-left", offsetY: 0.15 } });
    expect(nudged.style.watermark).toMatchObject({ corner: "bottom-left", offsetY: 0.15 });
  });

  it("swaps the image and keeps the rest", () => {
    const added = updateStyle(withLogo(), { watermark: { assetId: "logo", size: 0.2 } });
    expect(updateStyle(added, { watermark: { assetId: "logo2" } }).style.watermark).toMatchObject({
      assetId: "logo2",
      size: 0.2,
    });
  });

  it.each([
    ["no image for a new logo", { opacity: 0.5 }, "INVALID_INPUT"],
    ["a missing asset", { assetId: "nope" }, "ASSET_NOT_FOUND"],
    ["a video as logo", { assetId: "clip" }, "INVALID_MEDIA"],
    ["a logo too big", { assetId: "logo", size: 0.5 }, "INVALID_INPUT"],
    ["a logo too faint", { assetId: "logo", opacity: 0.05 }, "INVALID_INPUT"],
  ])("rejects %s", (_label, watermark, code) => {
    expect(() => updateStyle(withLogo(), { watermark })).toThrow(expect.objectContaining({ code }));
  });

  it("reads older projects without a logo", () => {
    expect(ProjectSchema.parse(project()).style.watermark).toBeUndefined();
  });
});

describe("project language", () => {
  it("defaults to Vietnamese, is set and validated, and stays a valid project", () => {
    const original = project();
    expect(projectLanguage(original)).toBe("vi");
    const english = setProjectLanguage(original, "en");
    expect(projectLanguage(english)).toBe("en");
    expect(ProjectSchema.parse(english).language).toBe("en");
    expect(() => setProjectLanguage(original, "fr" as "en")).toThrow();
  });

  it("is filled into the tasks that write or split narration, never the others", () => {
    const english = setProjectLanguage(project(), "en");
    const script = withProjectLanguage(
      { type: "script", input: { idea: "Mèo", targetDurationSec: 30, language: "vi" } },
      english,
    );
    expect(script.type === "script" && script.input.language).toBe("en");
    const rewrite = withProjectLanguage(
      { type: "rewrite_scene", input: { script: "", narration: "Một." } },
      english,
    );
    expect(rewrite.type === "rewrite_scene" && rewrite.input.language).toBe("en");
    const visual = {
      type: "visual" as const,
      input: { script: "", scenes: [{ id: "s1", narration: "Một." }] },
    };
    expect(withProjectLanguage(visual, english)).toBe(visual);
  });
});
