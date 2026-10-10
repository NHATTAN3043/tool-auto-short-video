import type { APIError } from "@anthropic-ai/sdk";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  AiTask,
  AiUsage,
  MediaRankingSuggestion,
  MediaRankRequest,
  ScenePlanRequest,
  ScenePlanSuggestion,
  SceneRewriteRequest,
  SceneRewriteSuggestion,
  ScriptRequest,
  ScriptSuggestion,
  VisualPlanRequest,
  VisualPlansSuggestion,
} from "@studio/domain";
import { AiCallError, type AiCall, type AiEstimate, type AiPort, type RankImage } from "@studio/services";
import type { z } from "zod";

import {
  candidateLabel,
  RANK_INTRO,
  rankPrompt,
  RankOutputSchema,
  rankSceneHeader,
  rewritePrompt,
  RewriteOutputSchema,
  scenesPrompt,
  ScenesOutputSchema,
  scriptPrompt,
  ScriptOutputSchema,
  SYSTEM_PROMPT,
  toVisualPlan,
  visualPrompt,
  VisualOutputSchema,
} from "./prompts";

export const CLAUDE_PROVIDER_ID = "claude";
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";

/** USD per million tokens. Unknown models are priced like the most expensive one, so limits stay safe. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};
const FALLBACK_PRICE = { input: 10, output: 50 };

const MAX_RETRIES = 2;
/** The structured output schema is sent with the request but not counted by count_tokens. */
const FORMAT_OVERHEAD_TOKENS = 400;

/**
 * Input tokens of one image (width × height / 750, after the API shrinks it to about 1.15 megapixels).
 * Stock thumbnails vary from tiny previews to full-size video posters: the worst case caps the estimate.
 */
export const IMAGE_TOKENS = { expected: 500, max: 1600 } as const;

/** Vietnamese takes roughly one token per 2.5 characters; only used to size `max_tokens` and estimates. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 2.5);
}

/** `max_tokens` and typical output per task. Thinking is billed as output, so both leave room for it. */
export function outputBudget(task: AiTask): { max: number; expected: number } {
  switch (task.type) {
    case "script": {
      const words = task.input.targetDurationSec * 2.6;
      return { max: 4000, expected: Math.round(words * 2 + 800) };
    }
    case "scenes": {
      const scriptTokens = approxTokens(task.input.script);
      const scenes = Math.ceil(task.input.script.split(/\s+/u).length / task.input.maxWordsPerScene);
      // About 150 tokens of plan per scene: intent plus keywords in three languages.
      const expected = Math.round(scriptTokens * 1.1 + scenes * 150 + 800);
      return { max: Math.min(32_000, Math.max(4000, expected * 2)), expected };
    }
    case "visual": {
      const expected = task.input.scenes.length * 160 + 800;
      return { max: Math.min(32_000, Math.max(3000, expected * 2)), expected };
    }
    case "rank_media": {
      // A short list of numbers per scene, plus room for thinking.
      const expected = task.input.scenes.length * 60 + 800;
      return { max: Math.min(16_000, Math.max(3000, expected * 2)), expected };
    }
    case "rewrite_scene": {
      const expected = approxTokens(task.input.narration) * 2 + 600;
      return { max: Math.max(2000, expected * 2), expected };
    }
  }
}

/** Candidates that will be sent as images in a vision ranking. */
function imageCount(task: AiTask): number {
  if (task.type !== "rank_media" || task.input.mode !== "vision") return 0;
  return task.input.scenes.reduce((sum, scene) => sum + scene.candidates.length, 0);
}

type UserContent = string | Anthropic.ContentBlockParam[];

function imageBlock(image: RankImage): Anthropic.ImageBlockParam {
  return image.type === "url"
    ? { type: "image", source: { type: "url", url: image.url } }
    : { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } };
}

/** A vision ranking: each candidate's line is followed by its thumbnail, when the service could get one. */
function rankContent(input: MediaRankRequest, images: ReadonlyMap<string, RankImage>): UserContent {
  if (input.mode !== "vision" || images.size === 0) return rankPrompt(input);
  const blocks: Anthropic.ContentBlockParam[] = [{ type: "text", text: RANK_INTRO }];
  for (const [index, scene] of input.scenes.entries()) {
    blocks.push({ type: "text", text: rankSceneHeader(scene, index) });
    for (const [c, candidate] of scene.candidates.entries()) {
      blocks.push({ type: "text", text: candidateLabel(candidate, c) });
      const image = images.get(candidate.key);
      if (image) blocks.push(imageBlock(image));
    }
  }
  return blocks;
}

function userPrompt(task: AiTask): string {
  switch (task.type) {
    case "script":
      return scriptPrompt(task.input);
    case "scenes":
      return scenesPrompt(task.input);
    case "visual":
      return visualPrompt(task.input);
    case "rank_media":
      return rankPrompt(task.input);
    case "rewrite_scene":
      return rewritePrompt(task.input);
  }
}

export interface ClaudeAiOptions {
  apiKey: string;
  model?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  timeoutMs?: number;
}

const retryable = (error: unknown): error is APIError =>
  error instanceof Anthropic.APIError &&
  error.status !== undefined &&
  (error.status === 429 || error.status >= 500);

/** Claude through the official SDK with structured outputs. Retries at most twice, only on 429 and 5xx. */
export class ClaudeAi implements AiPort {
  readonly id = CLAUDE_PROVIDER_ID;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly price: { input: number; output: number };

  constructor(private readonly options: ClaudeAiOptions) {
    this.model = options.model ?? DEFAULT_CLAUDE_MODEL;
    this.price = PRICES[this.model] ?? FALLBACK_PRICE;
    // The SDK would also retry 408/409 and network errors; the studio rule is 429/5xx only, done below.
    this.client = new Anthropic({
      apiKey: options.apiKey,
      maxRetries: 0,
      timeout: options.timeoutMs ?? 120_000,
      ...(options.fetch && { fetch: options.fetch }),
    });
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private usd(inputTokens: number, outputTokens: number): number {
    return (inputTokens * this.price.input + outputTokens * this.price.output) / 1_000_000;
  }

  async estimate(task: AiTask): Promise<AiEstimate> {
    const content = userPrompt(task);
    let inputTokens: number;
    try {
      const counted = await this.withRetry(() =>
        this.client.messages.countTokens({
          model: this.model,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
        }),
      );
      inputTokens = counted.input_tokens + FORMAT_OVERHEAD_TOKENS;
    } catch {
      // Counting is only for the estimate; fall back to the length heuristic instead of blocking the user.
      inputTokens = approxTokens(SYSTEM_PROMPT + content) + FORMAT_OVERHEAD_TOKENS;
    }
    // Images are counted apart: the text is counted for free, the thumbnails are not fetched for it.
    const images = imageCount(task);
    const budget = outputBudget(task);
    return {
      inputTokens: inputTokens + images * IMAGE_TOKENS.max,
      expectedOutputTokens: budget.expected,
      maxOutputTokens: budget.max,
      expectedUsd: this.usd(inputTokens + images * IMAGE_TOKENS.expected, budget.expected),
      maxUsd: this.usd(inputTokens + images * IMAGE_TOKENS.max, budget.max),
    };
  }

  async generateScript(input: ScriptRequest): Promise<AiCall<ScriptSuggestion>> {
    return this.run({ type: "script", input }, ScriptOutputSchema, (data) => data);
  }

  async planScenes(input: ScenePlanRequest): Promise<AiCall<ScenePlanSuggestion>> {
    return this.run({ type: "scenes", input }, ScenesOutputSchema, (data) => ({
      scenes: data.scenes.map(({ narration, ...fields }) => ({
        narration,
        visualPlan: toVisualPlan(fields),
      })),
    }));
  }

  async generateVisualPlans(input: VisualPlanRequest): Promise<AiCall<VisualPlansSuggestion>> {
    return this.run({ type: "visual", input }, VisualOutputSchema, (data) => ({
      // The model numbers scenes from 1; unknown numbers are dropped here, the domain checks the rest.
      plans: data.plans.flatMap(({ sceneNumber, ...fields }) => {
        const scene = input.scenes[sceneNumber - 1];
        return scene ? [{ sceneId: scene.id, visualPlan: toVisualPlan(fields) }] : [];
      }),
    }));
  }

  async rankMedia(
    input: MediaRankRequest,
    images: ReadonlyMap<string, RankImage>,
  ): Promise<AiCall<MediaRankingSuggestion>> {
    const content = rankContent(input, images);
    return this.run(
      { type: "rank_media", input },
      RankOutputSchema,
      (data) => ({
        // Numbers from 1 back to ids and keys; unknown numbers are dropped, the domain fills the rest.
        scenes: data.scenes.flatMap(({ sceneNumber, ranking }) => {
          const scene = input.scenes[sceneNumber - 1];
          if (!scene) return [];
          const keys = ranking.flatMap((number) => {
            const candidate = scene.candidates[number - 1];
            return candidate ? [candidate.key] : [];
          });
          return [{ sceneId: scene.sceneId, keys }];
        }),
      }),
      content,
    );
  }

  async rewriteScene(input: SceneRewriteRequest): Promise<AiCall<SceneRewriteSuggestion>> {
    return this.run({ type: "rewrite_scene", input }, RewriteOutputSchema, (data) => data);
  }

  private async run<S extends z.ZodType, T>(
    task: AiTask,
    schema: S,
    map: (data: z.infer<S>) => T,
    content: UserContent = userPrompt(task),
  ): Promise<AiCall<T>> {
    const format = zodOutputFormat(schema);
    let response: Anthropic.Message;
    try {
      response = await this.withRetry(() =>
        this.client.messages.create({
          model: this.model,
          max_tokens: outputBudget(task).max,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
          output_config: {
            format: { type: "json_schema", schema: format.schema },
            // Haiku 4.5 rejects `effort`; newer models think adaptively and `low` keeps that short.
            ...(!this.model.startsWith("claude-haiku") && { effort: "low" as const }),
          },
        }),
      );
    } catch (error) {
      throw new AiCallError("AI_FAILED", describeError(error));
    }

    const usage: AiUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      usd: this.usd(response.usage.input_tokens, response.usage.output_tokens),
    };
    if (response.stop_reason === "refusal") {
      throw new AiCallError("AI_REFUSED", "Claude declined the request", usage);
    }
    if (response.stop_reason === "max_tokens") {
      throw new AiCallError("AI_INVALID_OUTPUT", "câu trả lời bị cắt vì quá dài", usage);
    }
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AiCallError("AI_INVALID_OUTPUT", "không phải JSON hợp lệ", usage);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new AiCallError("AI_INVALID_OUTPUT", "sai cấu trúc yêu cầu", usage);
    return { data: map(parsed.data), usage };
  }

  private async withRetry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await call();
      } catch (error) {
        if (!retryable(error) || attempt >= MAX_RETRIES) throw error;
        await this.sleep(retryDelay(error, (this.options.retryDelayMs ?? 1000) * 2 ** attempt));
      }
    }
  }
}

function retryDelay(error: APIError, fallbackMs: number): number {
  const seconds = Number(error.headers?.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30_000) : fallbackMs;
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError)
    return "API key Claude không hợp lệ (ANTHROPIC_API_KEY)";
  if (error instanceof Anthropic.PermissionDeniedError) return "API key không có quyền dùng model này";
  if (error instanceof Anthropic.RateLimitError) return "Claude đang quá tải hoặc hết hạn mức, thử lại sau";
  if (error instanceof Anthropic.APIError) {
    const status = error.status === undefined ? "" : ` ${String(error.status)}`;
    if (error.status === 400 && /credit balance/iu.test(error.message)) {
      return "Tài khoản Claude API đã hết credit, nạp thêm trong Claude Console";
    }
    return `Claude${status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
