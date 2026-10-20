import { createProject, DomainError, type VoiceSettings } from "@studio/domain";
import { describe, expect, it } from "vitest";

import type { TtsPort } from "../ports/tts";
import { FakeTts, InMemoryProjectRepository, InMemoryStorage } from "../testing";
import { makeGetVoiceSample } from "./get-voice-sample";
import { makePreviewVoice } from "./preview-voice";

const voice: VoiceSettings = {
  provider: "fake",
  voiceId: "v1",
  modelId: "m1",
  stability: 1,
  similarityBoost: 0.75,
  speed: 1,
};

async function setup() {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const tts = new FakeTts();
  await repo.save(createProject({ name: "P", mode: "manual" }, { newId: () => "prj_1" }));
  const contexts: unknown[] = [];
  const preview = makePreviewVoice({
    repo,
    storage,
    tts: (context) => {
      contexts.push(context);
      return tts;
    },
  });
  return { repo, storage, tts, preview, contexts };
}

const input = { projectId: "prj_1", text: "  Xin   chào bạn ", voice, language: "vi" as const };

describe("previewVoice", () => {
  it("speaks the normalized text once, then serves the stored file for free", async () => {
    const s = await setup();
    const first = await s.preview(input);
    expect(first.cached).toBe(false);
    expect(first.path).toMatch(/^voice-previews\/[0-9a-f]{16}\.mp3$/u);
    expect(s.tts.calls).toEqual([{ text: "Xin chào bạn", voice, language: "vi" }]);
    expect(s.contexts).toEqual([{ projectId: "prj_1" }]);
    expect(s.storage.files.has(`projects/prj_1/${first.path}`)).toBe(true);

    const again = await s.preview({ ...input, text: "Xin chào bạn" });
    expect(again).toEqual({ path: first.path, cached: true });
    expect(s.tts.calls).toHaveLength(1);
  });

  it("makes a new preview when a setting or the language changes", async () => {
    const s = await setup();
    const base = await s.preview(input);
    const faster = await s.preview({ ...input, voice: { ...voice, speed: 1.1 } });
    const english = await s.preview({ ...input, language: "en" });
    expect(new Set([base.path, faster.path, english.path]).size).toBe(3);
    expect(s.tts.calls).toHaveLength(3);
  });

  it("leaves the project untouched", async () => {
    const s = await setup();
    const before = await s.repo.get("prj_1");
    await s.preview(input);
    expect(await s.repo.get("prj_1")).toEqual(before);
  });

  it("refuses empty or too long text without a paid call", async () => {
    const s = await setup();
    await expect(s.preview({ ...input, text: "   " })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.preview({ ...input, text: "a".repeat(201) })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(s.tts.calls).toEqual([]);
  });

  it("refuses a voice of another provider", async () => {
    const s = await setup();
    await expect(s.preview({ ...input, voice: { ...voice, provider: "other" } })).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
  });

  it("reports a provider failure as TTS_FAILED and stores nothing", async () => {
    const s = await setup();
    s.tts.failFor.add("Xin chào bạn");
    await expect(s.preview(input)).rejects.toMatchObject({ code: "TTS_FAILED" });
    expect([...s.storage.files.keys()].some((key) => key.includes("voice-previews"))).toBe(false);
  });

  it("lets a budget refusal through unchanged", async () => {
    const s = await setup();
    const blocked: TtsPort = {
      id: s.tts.id,
      models: s.tts.models,
      listVoices: () => s.tts.listVoices(),
      voiceSample: (voiceId) => s.tts.voiceSample(voiceId),
      estimate: (text) => s.tts.estimate(text),
      synthesize: () => Promise.reject(new DomainError("BUDGET_EXCEEDED", "Vượt ngân sách")),
    };
    const preview = makePreviewVoice({ repo: s.repo, storage: s.storage, tts: () => blocked });
    await expect(preview(input)).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });
});

describe("getVoiceSample", () => {
  it("returns the provider's sample", async () => {
    const get = makeGetVoiceSample({ tts: new FakeTts() });
    expect(await get("v1")).toMatchObject({ extension: "mp3" });
  });

  it("reports a voice without sample as not found, a provider error as TTS_FAILED", async () => {
    const tts = new FakeTts();
    const get = makeGetVoiceSample({ tts });
    await expect(get("v2")).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    tts.failList = true;
    await expect(get("v1")).rejects.toMatchObject({ code: "TTS_FAILED" });
  });
});
