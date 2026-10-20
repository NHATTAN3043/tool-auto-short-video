import { describe, expect, it } from "vitest";

import { asset, project } from "../testing/fixtures";
import { withProjectLanguage } from "../ai/apply";
import { projectLanguage, setMusic, setProjectLanguage, setProjectVoice, updateStyle } from "./operations";
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
