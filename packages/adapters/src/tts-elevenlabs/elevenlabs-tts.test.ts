import type { VoiceSettings } from "@studio/domain";
import { describe, expect, it, vi } from "vitest";

import { ElevenLabsError, ElevenLabsTts } from "./elevenlabs-tts";

const voice: VoiceSettings = {
  provider: "elevenlabs",
  voiceId: "voice/1",
  modelId: "eleven_flash_v2_5",
  stability: 0.4,
  similarityBoost: 0.8,
  speed: 1.05,
};

function setup(responses: (() => Response)[]) {
  const fetchFn = vi.fn<typeof fetch>(() => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return Promise.resolve(next());
  });
  const sleep = vi.fn(() => Promise.resolve());
  const tts = new ElevenLabsTts({
    apiKey: "secret",
    usdPerCredit: 0.0006,
    fetch: fetchFn,
    sleep,
  });
  return { tts, fetchFn, sleep };
}

const audio = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
const status =
  (code: number, body = "") =>
  () =>
    new Response(body, { status: code });

describe("ElevenLabsTts", () => {
  it("posts the narration with the voice settings and returns mp3 bytes", async () => {
    const s = setup([audio]);
    const speech = await s.tts.synthesize("Xin chào", voice, "vi");
    expect(speech).toEqual({ audio: new Uint8Array([1, 2, 3]), extension: "mp3" });

    const [url, init] = s.fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice%2F1?output_format=mp3_44100_128");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("xi-api-key")).toBe("secret");
    expect(JSON.parse(init?.body as string)).toEqual({
      text: "Xin chào",
      model_id: "eleven_flash_v2_5",
      language_code: "vi",
      voice_settings: { stability: 0.4, similarity_boost: 0.8, speed: 1.05 },
    });
  });

  it("tells the project language to models that take it, and only to those", async () => {
    const s = setup([audio, audio, audio]);
    await s.tts.synthesize("Hello there", voice, "en");
    expect(JSON.parse(s.fetchFn.mock.calls[0]?.[1]?.body as string)).toMatchObject({ language_code: "en" });

    await s.tts.synthesize("Xin chào", { ...voice, modelId: "eleven_v3" }, "vi");
    expect(JSON.parse(s.fetchFn.mock.calls[1]?.[1]?.body as string)).toMatchObject({ language_code: "vi" });

    await s.tts.synthesize("Xin chào", { ...voice, modelId: "eleven_multilingual_v2" }, "vi");
    const other = JSON.parse(s.fetchFn.mock.calls[2]?.[1]?.body as string) as Record<string, unknown>;
    expect("language_code" in other).toBe(false);
  });

  it("sends the neighbouring narration as context, except to eleven_v3", async () => {
    const context = { previousText: "Câu trước.", nextText: "Câu sau." };
    const s = setup([audio, audio, audio]);
    await s.tts.synthesize("Xin chào", voice, "vi", context);
    expect(JSON.parse(s.fetchFn.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      previous_text: "Câu trước.",
      next_text: "Câu sau.",
    });

    await s.tts.synthesize("Xin chào", voice, "vi", { nextText: "Câu sau." });
    const firstScene = JSON.parse(s.fetchFn.mock.calls[1]?.[1]?.body as string) as Record<string, unknown>;
    expect("previous_text" in firstScene).toBe(false);
    expect(firstScene.next_text).toBe("Câu sau.");

    await s.tts.synthesize("Xin chào", { ...voice, modelId: "eleven_v3" }, "vi", context);
    const v3 = JSON.parse(s.fetchFn.mock.calls[2]?.[1]?.body as string) as Record<string, unknown>;
    expect("previous_text" in v3 || "next_text" in v3).toBe(false);
  });

  it("retries 429 and 5xx at most twice", async () => {
    const ok = setup([status(429), status(503), audio]);
    await expect(ok.tts.synthesize("x", voice, "vi")).resolves.toBeDefined();
    expect(ok.sleep.mock.calls).toEqual([[1000], [2000]]);

    const failing = setup([status(500), status(502), status(503), audio]);
    await expect(failing.tts.synthesize("x", voice, "vi")).rejects.toMatchObject({ status: 503 });
    expect(failing.fetchFn).toHaveBeenCalledTimes(3);
  });

  it("honours Retry-After", async () => {
    const s = setup([() => new Response("", { status: 429, headers: { "retry-after": "3" } }), audio]);
    await s.tts.synthesize("x", voice, "vi");
    expect(s.sleep.mock.calls).toEqual([[3000]]);
  });

  it("does not retry client errors and reports the provider message", async () => {
    const s = setup([
      status(401, JSON.stringify({ detail: { status: "invalid_api_key", message: "Bad key" } })),
    ]);
    const error = await s.tts.synthesize("x", voice, "vi").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElevenLabsError);
    expect(error).toMatchObject({ status: 401, message: "ElevenLabs 401: Bad key" });
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rejects empty audio", async () => {
    const s = setup([() => new Response(new Uint8Array(), { status: 200 })]);
    await expect(s.tts.synthesize("x", voice, "vi")).rejects.toThrow(/empty audio/u);
  });

  it("lists voices with their labels", async () => {
    const s = setup([
      () =>
        Response.json({
          voices: [
            { voice_id: "a", name: "An", labels: { gender: "male", accent: null } },
            { voice_id: "b", name: "Bình" },
          ],
        }),
    ]);
    expect(await s.tts.listVoices()).toEqual([
      { id: "a", name: "An", labels: { gender: "male" } },
      { id: "b", name: "Bình", labels: {} },
    ]);
    expect(s.fetchFn.mock.calls[0]?.[0]).toBe("https://api.elevenlabs.io/v1/voices");
  });

  it("estimates credits by model and price per credit", () => {
    const { tts } = setup([]);
    expect(tts.estimate("Xin chào", voice)).toEqual({ characters: 8, credits: 4, usd: 4 * 0.0006 });
    expect(tts.estimate("Xin chào", { ...voice, modelId: "eleven_v3" }).credits).toBe(8);
  });

  it("fetches the voice's recorded sample without sending the API key to the sample host", async () => {
    const s = setup([
      () => Response.json({ voice_id: "voice/1", preview_url: "https://cdn.example/sample.mp3" }),
      audio,
    ]);
    expect(await s.tts.voiceSample("voice/1")).toEqual({
      audio: new Uint8Array([1, 2, 3]),
      extension: "mp3",
    });
    expect(s.fetchFn.mock.calls[0]?.[0]).toBe("https://api.elevenlabs.io/v1/voices/voice%2F1");
    const [sampleUrl, sampleInit] = s.fetchFn.mock.calls[1] ?? [];
    expect(sampleUrl).toBe("https://cdn.example/sample.mp3");
    expect(new Headers(sampleInit?.headers).get("xi-api-key")).toBeNull();
  });

  it("has no sample for a voice without one", async () => {
    const s = setup([() => Response.json({ voice_id: "v", preview_url: null })]);
    expect(await s.tts.voiceSample("v")).toBeNull();
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reports a failed sample download", async () => {
    const s = setup([() => Response.json({ preview_url: "https://cdn.example/x.mp3" }), status(403)]);
    await expect(s.tts.voiceSample("v")).rejects.toBeInstanceOf(ElevenLabsError);
  });
});
