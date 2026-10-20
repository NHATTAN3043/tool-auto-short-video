import type { ContentLanguage, VoiceSettings } from "@studio/domain";
import type {
  SpeechContext,
  SynthesizedSpeech,
  TtsEstimate,
  TtsModel,
  TtsPort,
  TtsVoice,
} from "@studio/services";
import { z } from "zod";

export const ELEVENLABS_PROVIDER_ID = "elevenlabs";

/**
 * Models that speak every studio language (Vietnamese and English), default first. Credit rates from elevenlabs.io/docs/models; check them
 * again when the price list changes.
 */
export const ELEVENLABS_MODELS: readonly TtsModel[] = [
  { id: "eleven_flash_v2_5", name: "Flash v2.5 (nhanh, rẻ)", creditsPerCharacter: 0.5 },
  { id: "eleven_v3", name: "Eleven v3 (biểu cảm hơn)", creditsPerCharacter: 1 },
];

const OUTPUT_FORMAT = "mp3_44100_128";
/** Request stitching (previous/next context) is not available for these models (ElevenLabs docs). */
const MODELS_WITHOUT_CONTEXT = new Set(["eleven_v3"]);
/**
 * Models that take `language_code`; the docs rule out multilingual_v2, so it is only sent to these.
 * Telling the language stops the model guessing from a short scene and reading Vietnamese as English.
 */
const MODELS_WITH_LANGUAGE_CODE = new Set(["eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_v3"]);
const MAX_RETRIES = 2;

export interface ElevenLabsTtsOptions {
  apiKey: string;
  /** Plan price of one credit, e.g. 6 USD / 10 000 credits = 0.0006. */
  usdPerCredit: number;
  baseUrl?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  /** First retry delay; doubles on the second retry. */
  retryDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const VoicesResponseSchema = z.object({
  voices: z.array(
    z.object({
      voice_id: z.string().min(1),
      name: z.string(),
      labels: z.record(z.string(), z.string().nullable()).nullish(),
    }),
  ),
});

/** One voice from `GET /v1/voices/{id}`; only its recorded sample is read. */
const VoiceResponseSchema = z.object({ preview_url: z.string().nullish() });

const ErrorBodySchema = z.object({
  detail: z.union([z.string(), z.object({ message: z.string() }).loose()]),
});

export class ElevenLabsError extends Error {
  override readonly name = "ElevenLabsError";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const retryable = (status: number) => status === 429 || status >= 500;

/** ElevenLabs text-to-speech over its REST API. Retries at most twice, only on 429 and 5xx. */
export class ElevenLabsTts implements TtsPort {
  readonly id = ELEVENLABS_PROVIDER_ID;
  readonly models = ELEVENLABS_MODELS;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: ElevenLabsTtsOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.elevenlabs.io").replace(/\/+$/u, "");
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async listVoices(): Promise<TtsVoice[]> {
    const response = await this.request("/v1/voices", { method: "GET" });
    const body = VoicesResponseSchema.parse(await response.json());
    return body.voices.map((voice) => ({
      id: voice.voice_id,
      name: voice.name,
      labels: Object.fromEntries(
        Object.entries(voice.labels ?? {}).filter((entry): entry is [string, string] => entry[1] !== null),
      ),
    }));
  }

  /** The sample ElevenLabs recorded for the voice (free). The sample host gets no API key. */
  async voiceSample(voiceId: string): Promise<SynthesizedSpeech | null> {
    const response = await this.request(`/v1/voices/${encodeURIComponent(voiceId)}`, { method: "GET" });
    const previewUrl = VoiceResponseSchema.parse(await response.json()).preview_url;
    if (!previewUrl?.startsWith("https://")) return null;
    const sample = await this.fetchFn(previewUrl, {
      method: "GET",
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
    });
    if (!sample.ok) throw new ElevenLabsError(sample.status, `ElevenLabs sample ${String(sample.status)}`);
    const audio = new Uint8Array(await sample.arrayBuffer());
    return audio.length === 0 ? null : { audio, extension: "mp3" };
  }

  estimate(text: string, voice: VoiceSettings): TtsEstimate {
    const characters = text.length;
    const rate = this.models.find((model) => model.id === voice.modelId)?.creditsPerCharacter ?? 1;
    const credits = Math.ceil(characters * rate);
    return { characters, credits, usd: credits * this.options.usdPerCredit };
  }

  async synthesize(
    text: string,
    voice: VoiceSettings,
    language: ContentLanguage,
    context?: SpeechContext,
  ): Promise<SynthesizedSpeech> {
    // The narration around this scene keeps pace and tone even across scenes generated one by one.
    const withContext = context !== undefined && !MODELS_WITHOUT_CONTEXT.has(voice.modelId);
    const response = await this.request(
      `/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}?output_format=${OUTPUT_FORMAT}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: voice.modelId,
          ...(MODELS_WITH_LANGUAGE_CODE.has(voice.modelId) && { language_code: language }),
          voice_settings: {
            stability: voice.stability,
            similarity_boost: voice.similarityBoost,
            speed: voice.speed,
          },
          ...(withContext && context.previousText && { previous_text: context.previousText }),
          ...(withContext && context.nextText && { next_text: context.nextText }),
        }),
      },
    );
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.length === 0) throw new ElevenLabsError(response.status, "ElevenLabs returned empty audio");
    return { audio, extension: "mp3" };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("xi-api-key", this.options.apiKey);
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      });
      if (response.ok) return response;
      if (!retryable(response.status) || attempt >= MAX_RETRIES) {
        throw new ElevenLabsError(response.status, await describeError(response));
      }
      await response.body?.cancel();
      await this.sleep(retryDelay(response, (this.options.retryDelayMs ?? 1000) * 2 ** attempt));
    }
  }
}

function retryDelay(response: Response, fallbackMs: number): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30_000) : fallbackMs;
}

async function describeError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  let detail = text.slice(0, 300);
  try {
    const parsed = ErrorBodySchema.safeParse(JSON.parse(text));
    if (parsed.success) {
      detail = typeof parsed.data.detail === "string" ? parsed.data.detail : parsed.data.detail.message;
    }
  } catch {
    // Not JSON: keep the raw (truncated) text.
  }
  return `ElevenLabs ${String(response.status)}${detail === "" ? "" : `: ${detail}`}`;
}
