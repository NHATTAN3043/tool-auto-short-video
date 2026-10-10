import {
  createProject,
  voiceContentHash,
  type MediaAsset,
  type Project,
  type RenderJob,
  type VoiceSettings,
} from "@studio/domain";
import { describe, expect, it } from "vitest";

import type { VoiceCatalog } from "./api";
import {
  canGenerate,
  estimateSummary,
  formatUsd,
  initialVoiceSettings,
  isRunning,
  isVoiceJob,
  jobCoversScene,
  sceneNumbers,
  voiceOptionLabel,
  voiceOverview,
} from "./model";

const catalog: VoiceCatalog = {
  provider: "elevenlabs",
  models: [{ id: "eleven_flash_v2_5", name: "Flash", creditsPerCharacter: 0.5 }],
  voices: [
    { id: "a", name: "An", labels: { gender: "male", age: "young", accent: "" } },
    { id: "b", name: "Bình", labels: {} },
  ],
  defaults: { provider: "elevenlabs", modelId: "eleven_flash_v2_5" },
};

const job = (extra: Partial<RenderJob> = {}): RenderJob => ({
  id: "job_1",
  projectId: "prj_1",
  kind: "tts",
  sceneIds: ["s1"],
  status: "QUEUED",
  progress: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

describe("voice model", () => {
  it("starts from the configured voice, else the first voice of the account", () => {
    expect(initialVoiceSettings(catalog)).toEqual({
      provider: "elevenlabs",
      voiceId: "a",
      modelId: "eleven_flash_v2_5",
      stability: 0.5,
      similarityBoost: 0.75,
      speed: 1,
    });
    const configured = { ...catalog, defaults: { provider: "elevenlabs", modelId: "x", voiceId: "b" } };
    expect(initialVoiceSettings(configured)).toMatchObject({ voiceId: "b", modelId: "x" });
    expect(initialVoiceSettings({ ...catalog, voices: [] })).toBeNull();
  });

  it("labels voices with their useful tags", () => {
    expect(voiceOptionLabel(catalog.voices[0] ?? { id: "", name: "", labels: {} })).toBe("An · male, young");
    expect(voiceOptionLabel(catalog.voices[1] ?? { id: "", name: "", labels: {} })).toBe("Bình");
  });

  it("formats costs in Vietnamese", () => {
    expect(formatUsd(0.036)).toBe("0,036 USD");
    expect(formatUsd(1.5)).toBe("1,50 USD");
    expect(formatUsd(0.0003)).toBe("< 0,001 USD");
    expect(estimateSummary({ sceneIds: ["a", "b"], characters: 1200, credits: 600, usd: 0.36 })).toBe(
      "2 cảnh · 1.200 ký tự · 600 credit · ≈ 0,360 USD",
    );
  });

  it("tracks running voice jobs and the scenes they cover", () => {
    expect(isVoiceJob(job())).toBe(true);
    expect(isVoiceJob(job({ kind: "capcut" }))).toBe(false);
    expect(isRunning(null)).toBe(false);
    expect(isRunning(job({ status: "PROCESSING" }))).toBe(true);
    expect(isRunning(job({ status: "FAILED" }))).toBe(false);
    expect(jobCoversScene(job(), "s1")).toBe(true);
    expect(jobCoversScene(job(), "s2")).toBe(false);
    expect(jobCoversScene(job({ status: "COMPLETED" }), "s1")).toBe(false);
    expect(canGenerate("missing") && canGenerate("outdated")).toBe(true);
    expect(canGenerate("current") || canGenerate("uploaded") || canGenerate("empty")).toBe(false);
  });

  it("summarises which scenes need a voice", () => {
    const voice: VoiceSettings = {
      provider: "elevenlabs",
      voiceId: "a",
      modelId: "m",
      stability: 0.5,
      similarityBoost: 0.75,
      speed: 1,
    };
    const tts = (id: string, text: string): MediaAsset => ({
      id,
      kind: "audio",
      source: "tts",
      fileName: `${id}.mp3`,
      path: `media/${id}.mp3`,
      contentHash: voiceContentHash(text, voice),
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const project: Project = {
      ...createProject({ name: "P", mode: "assisted" }, { newId: () => "prj_1" }),
      voice,
      assets: [tts("v1", "Một."), tts("v2", "Hai cũ.")],
      scenes: [
        { id: "s1", narration: "Một.", status: "draft", voiceAssetId: "v1" },
        { id: "s2", narration: "Hai mới.", status: "draft", voiceAssetId: "v2" },
        { id: "s3", narration: "Ba.", status: "draft" },
      ],
    };
    expect(voiceOverview(project)).toEqual({ needed: ["s2", "s3"], missing: 1, outdated: 1 });
    expect(sceneNumbers(project, ["s3", "s1"])).toBe("1, 3");
  });
});
