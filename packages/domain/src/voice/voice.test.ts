import { describe, expect, it } from "vitest";

import { DomainError } from "../errors";
import { ProjectSchema, type Project } from "../project/schema";
import { asset, project, scene } from "../testing/fixtures";
import { voiceContentHash } from "./content-hash";
import { setSceneVoice, setVoiceSettings, setVoiceTrack } from "./operations";
import type { VoiceSettings } from "./schema";
import { activeVoiceTrack, hasVoiceConflict, sceneVoiceStatus, scenesNeedingVoice } from "./voice-status";

const settings: VoiceSettings = {
  provider: "elevenlabs",
  voiceId: "v1",
  modelId: "eleven_flash_v2_5",
  stability: 0.5,
  similarityBoost: 0.75,
  speed: 1,
};

function ttsAsset(id: string, narration: string, voice: VoiceSettings = settings) {
  return asset(id, "audio", { source: "tts", contentHash: voiceContentHash(narration, voice) });
}

describe("voiceContentHash", () => {
  it("is stable and ignores whitespace differences", () => {
    const hash = voiceContentHash("Xin chào  các bạn", settings);
    expect(hash).toMatch(/^tts1:[0-9a-f]{16}$/u);
    expect(voiceContentHash(" Xin chào\ncác bạn ", settings)).toBe(hash);
  });

  it("changes with the narration and with every voice setting", () => {
    const hash = voiceContentHash("Xin chào", settings);
    expect(voiceContentHash("Xin chao", settings)).not.toBe(hash);
    for (const patch of [
      { voiceId: "v2" },
      { modelId: "eleven_v3" },
      { stability: 0.6 },
      { similarityBoost: 0.7 },
      { speed: 1.1 },
      { provider: "other" },
    ]) {
      expect(voiceContentHash("Xin chào", { ...settings, ...patch })).not.toBe(hash);
    }
  });
});

describe("sceneVoiceStatus / scenesNeedingVoice", () => {
  const p = project({
    voice: settings,
    assets: [ttsAsset("fresh", "Một."), ttsAsset("old", "Cũ."), asset("up", "audio")],
    scenes: [
      scene("a", "Một.", { voiceAssetId: "fresh" }),
      scene("b", "Mới.", { voiceAssetId: "old" }),
      scene("c", "Ba."),
      scene("d", "Bốn.", { voiceAssetId: "up" }),
      scene("e", "   "),
      scene("f", "Sáu.", { voiceAssetId: "gone" }),
    ],
  });

  it("classifies every scene", () => {
    expect(p.scenes.map((s) => sceneVoiceStatus(p, s))).toEqual([
      "current",
      "outdated",
      "missing",
      "uploaded",
      "empty",
      "missing",
    ]);
  });

  it("marks every generated voice outdated when the voice settings change", () => {
    const changed = { ...p, voice: { ...settings, speed: 1.1 } };
    expect(sceneVoiceStatus(changed, p.scenes[0] ?? scene("x", ""))).toBe("outdated");
  });

  it("lists missing and outdated scenes in order, optionally within a selection", () => {
    expect(scenesNeedingVoice(p)).toEqual(["b", "c", "f"]);
    expect(scenesNeedingVoice(p, ["a", "c", "d"])).toEqual(["c"]);
  });
});

describe("voice track", () => {
  const voices = [asset("voice", "audio"), asset("sv", "audio")];

  it("is null without voices and the only kind present otherwise", () => {
    expect(activeVoiceTrack(project({ scenes: [scene("a", "x")] }))).toBeNull();
    expect(activeVoiceTrack(project({ assets: voices, voiceAssetId: "voice" }))).toBe("project");
    const scenesOnly = project({ assets: voices, scenes: [scene("a", "x", { voiceAssetId: "sv" })] });
    expect(activeVoiceTrack(scenesOnly)).toBe("scenes");
    // A leftover choice does not mute the only voice there is.
    expect(activeVoiceTrack({ ...scenesOnly, voiceTrack: "project" })).toBe("scenes");
    expect(hasVoiceConflict(scenesOnly)).toBe(false);
  });

  it("follows the user's choice when both exist, defaulting to the project voice", () => {
    const both = project({
      assets: voices,
      voiceAssetId: "voice",
      scenes: [scene("a", "x", { voiceAssetId: "sv" })],
    });
    expect(hasVoiceConflict(both)).toBe(true);
    expect(activeVoiceTrack(both)).toBe("project");
    expect(activeVoiceTrack(setVoiceTrack(both, "scenes"))).toBe("scenes");
  });
});

describe("voice operations", () => {
  const base: Project = project({
    assets: [ttsAsset("old", "Một.")],
    scenes: [scene("a", "Một.", { voiceAssetId: "old" }), scene("b", "Hai.")],
  });

  it("adds the voice asset and points the scene at it, keeping the old asset", () => {
    const next = setSceneVoice(base, "a", ttsAsset("new", "Một."));
    expect(next.scenes[0]?.voiceAssetId).toBe("new");
    expect(next.scenes[1]).toEqual(base.scenes[1]);
    expect(next.assets.map((a) => a.id)).toEqual(["old", "new"]);
    expect(base.scenes[0]?.voiceAssetId).toBe("old");
  });

  it("rejects unknown scenes and non-audio assets", () => {
    expect(() => setSceneVoice(base, "zzz", ttsAsset("n", "x"))).toThrow(DomainError);
    expect(() => setSceneVoice(base, "a", asset("img", "image"))).toThrow(/audio/u);
  });

  it("sets, validates and clears voice settings", () => {
    const withVoice = setVoiceSettings(base, settings);
    expect(withVoice.voice).toEqual(settings);
    expect(ProjectSchema.parse(withVoice)).toEqual(withVoice);
    expect(() => setVoiceSettings(base, { ...settings, speed: 3 })).toThrow(DomainError);
    expect("voice" in setVoiceSettings(withVoice, null)).toBe(false);
  });
});
