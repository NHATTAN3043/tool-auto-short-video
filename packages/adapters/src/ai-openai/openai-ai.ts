import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  AiTask,
  AiUsage,
  BriefQuestionsRequest,
  DescribeShotsRequest,
  MediaRankRequest,
  ScenePlanRequest,
  SceneRewriteRequest,
  ScriptOutlineRequest,
  ScriptRequest,
  ShotDescriptions,
  SkillGuidance,
  SourceCutRequest,
  VisualPlanRequest,
} from "@studio/domain";
import { AiCallError, type AiCall, type AiEstimate, type AiPort, type RankImage } from "@studio/services";
import type { z } from "zod";

import {
  approxTokens,
  BriefQuestionsOutputSchema,
  briefQuestionsPrompt,
  candidateLabel,
  languageReminder,
  narrationLanguage,
  OutlineOutputSchema,
  outlinePrompt,
  outputBudget,
  rankPrompt,
  RankOutputSchema,
  rankSceneHeader,
  rewritePrompt,
  RewriteOutputSchema,
  scenesPrompt,
  ScenesOutputSchema,
  scriptPrompt,
  ScriptOutputSchema,
  shotLabel,
  shotsIntro,
  shotsOutputBudget,
  ShotsOutputSchema,
  SHOTS_SYSTEM_PROMPT,
  sourceCutFromOutput,
  sourceCutPrompt,
  SourceCutOutputSchema,
  systemPrompt,
  toVisualPlan,
  visualPrompt,
  VisualOutputSchema,
} from "../ai-common";

export const OPENAI_PROVIDER_ID = "openai";
export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

/** USD per million tokens. Unknown live models use a deliberately conservative ceiling. */
const PRICES: Record<string, { input: number; output: number }> = {
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-6.1-sol": { input: 2, output: 10 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
};
const FALLBACK_PRICE = { input: 15, output: 75 };
const MAX_RETRIES = 2;
const FORMAT_OVERHEAD_TOKENS = 400;
const IMAGE_TOKENS = { expected: 500, max: 1800 } as const;
const SHOT_IMAGE_TOKENS = { expected: 180, max: 400 } as const;

type InputContent =
  { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "low" };

function dataUrl(image: Extract<RankImage, { type: "base64" }>): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

function imagePart(image: RankImage): InputContent {
  return {
    type: "input_image",
    image_url: image.type === "url" ? image.url : dataUrl(image),
    detail: "low",
  };
}

function rankContent(input: MediaRankRequest, images: ReadonlyMap<string, RankImage>): InputContent[] {
  if (input.mode !== "vision" || images.size === 0) return [{ type: "input_text", text: rankPrompt(input) }];
  const content: InputContent[] = [];
  for (const [index, scene] of input.scenes.entries()) {
    content.push({ type: "input_text", text: rankSceneHeader(scene, index) });
    for (const [candidateIndex, candidate] of scene.candidates.entries()) {
      content.push({ type: "input_text", text: candidateLabel(candidate, candidateIndex) });
      const image = images.get(candidate.key);
      if (image) content.push(imagePart(image));
    }
  }
  return content;
}

function taskPrompt(task: AiTask): string {
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
    case "brief_questions":
      return briefQuestionsPrompt(task.input);
    case "script_outline":
      return outlinePrompt(task.input);
    case "source_cut":
      return sourceCutPrompt(task.input);
  }
}

function userPrompt(task: AiTask, guidance?: SkillGuidance): string {
  const prompt = taskPrompt(task);
  if (task.type === "rank_media" || task.type === "brief_questions") return prompt;
  const language = narrationLanguage(task);
  return guidance === undefined && language === "vi" ? prompt : `${prompt}\n\n${languageReminder(language)}`;
}

export interface OpenAiOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  timeoutMs?: number;
}

/** OpenAI Responses API adapter with the same structured domain contract as ClaudeAi. */
export class OpenAi implements AiPort {
  readonly id = OPENAI_PROVIDER_ID;
  readonly model: string;
  private readonly client: OpenAI;
  private readonly price: { input: number; output: number };
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: OpenAiOptions) {
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.price = PRICES[this.model] ?? FALLBACK_PRICE;
    this.client = new OpenAI({
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

  async estimate(task: AiTask, guidance?: SkillGuidance): Promise<AiEstimate> {
    await Promise.resolve();
    const text = systemPrompt(task, guidance) + userPrompt(task, guidance);
    const images =
      task.type === "rank_media" && task.input.mode === "vision"
        ? task.input.scenes.reduce((sum, scene) => sum + scene.candidates.length, 0)
        : 0;
    const inputTokens = approxTokens(text) + FORMAT_OVERHEAD_TOKENS;
    const budget = outputBudget(task);
    return {
      inputTokens: inputTokens + images * IMAGE_TOKENS.max,
      expectedOutputTokens: budget.expected,
      maxOutputTokens: budget.max,
      expectedUsd: this.usd(inputTokens + images * IMAGE_TOKENS.expected, budget.expected),
      maxUsd: this.usd(inputTokens + images * IMAGE_TOKENS.max, budget.max),
    };
  }

  estimateShots(shotCount: number): AiEstimate {
    const inputTokens = approxTokens(SHOTS_SYSTEM_PROMPT) + FORMAT_OVERHEAD_TOKENS + shotCount * 15;
    const budget = shotsOutputBudget(shotCount);
    return {
      inputTokens: inputTokens + shotCount * SHOT_IMAGE_TOKENS.max,
      expectedOutputTokens: budget.expected,
      maxOutputTokens: budget.max,
      expectedUsd: this.usd(inputTokens + shotCount * SHOT_IMAGE_TOKENS.expected, budget.expected),
      maxUsd: this.usd(inputTokens + shotCount * SHOT_IMAGE_TOKENS.max, budget.max),
    };
  }

  async describeShots(
    input: DescribeShotsRequest,
    frames: readonly RankImage[],
  ): Promise<AiCall<ShotDescriptions>> {
    if (frames.length !== input.shots.length) {
      throw new AiCallError(
        "AI_FAILED",
        `${String(frames.length)} ảnh cho ${String(input.shots.length)} đoạn`,
      );
    }
    const content: InputContent[] = [{ type: "input_text", text: shotsIntro(input) }];
    for (const [index, shot] of input.shots.entries()) {
      content.push({ type: "input_text", text: shotLabel(shot, index) });
      const frame = frames[index];
      if (frame) content.push(imagePart(frame));
    }
    return this.send(
      SHOTS_SYSTEM_PROMPT,
      content,
      shotsOutputBudget(input.shots.length).max,
      ShotsOutputSchema,
      (data) => ({
        shots: data.shots.map(({ shotNumber, description, tagsEn, tagsVi, textOverlay }) => ({
          index: shotNumber - 1,
          description,
          tags: [...tagsEn, ...tagsVi],
          textOverlay,
        })),
      }),
    );
  }

  generateScript(input: ScriptRequest, guidance?: SkillGuidance) {
    return this.run({ type: "script", input }, ScriptOutputSchema, (data) => data, guidance);
  }
  planScenes(input: ScenePlanRequest, guidance?: SkillGuidance) {
    return this.run(
      { type: "scenes", input },
      ScenesOutputSchema,
      (data) => ({
        scenes: data.scenes.map(({ narration, ...fields }) => ({
          narration,
          visualPlan: toVisualPlan(fields),
        })),
      }),
      guidance,
    );
  }
  generateVisualPlans(input: VisualPlanRequest, guidance?: SkillGuidance) {
    return this.run(
      { type: "visual", input },
      VisualOutputSchema,
      (data) => ({
        plans: data.plans.flatMap(({ sceneNumber, ...fields }) => {
          const scene = input.scenes[sceneNumber - 1];
          return scene ? [{ sceneId: scene.id, visualPlan: toVisualPlan(fields) }] : [];
        }),
      }),
      guidance,
    );
  }
  rankMedia(input: MediaRankRequest, images: ReadonlyMap<string, RankImage>) {
    return this.run(
      { type: "rank_media", input },
      RankOutputSchema,
      (data) => ({
        scenes: data.scenes.flatMap(({ sceneNumber, ranking, rejected }) => {
          const scene = input.scenes[sceneNumber - 1];
          if (!scene) return [];
          const keys = (numbers: readonly number[]) =>
            numbers.flatMap((n) => scene.candidates[n - 1]?.key ?? []);
          const dropped = keys(rejected ?? []);
          return [
            { sceneId: scene.sceneId, keys: keys(ranking), ...(dropped.length > 0 && { rejected: dropped }) },
          ];
        }),
      }),
      undefined,
      rankContent(input, images),
    );
  }
  rewriteScene(input: SceneRewriteRequest, guidance?: SkillGuidance) {
    return this.run({ type: "rewrite_scene", input }, RewriteOutputSchema, (data) => data, guidance);
  }
  generateBriefQuestions(input: BriefQuestionsRequest, guidance?: SkillGuidance) {
    return this.run(
      { type: "brief_questions", input },
      BriefQuestionsOutputSchema,
      (data) => ({
        questions: data.questions.map((question, index) => ({ id: `q${String(index + 1)}`, ...question })),
      }),
      guidance,
    );
  }
  generateScriptOutline(input: ScriptOutlineRequest, guidance?: SkillGuidance) {
    return this.run(
      { type: "script_outline", input },
      OutlineOutputSchema,
      (data) => ({
        title: data.title,
        scenes: data.scenes.map(({ narration, ...fields }) => ({
          narration,
          visualPlan: toVisualPlan(fields),
        })),
      }),
      guidance,
    );
  }

  planSourceCut(input: SourceCutRequest, guidance?: SkillGuidance) {
    return this.run(
      { type: "source_cut", input },
      SourceCutOutputSchema,
      (data) => sourceCutFromOutput(data, input),
      guidance,
    );
  }

  private run<S extends z.ZodType, T>(
    task: AiTask,
    schema: S,
    map: (data: z.infer<S>) => T,
    guidance?: SkillGuidance,
    content: InputContent[] = [{ type: "input_text", text: userPrompt(task, guidance) }],
  ): Promise<AiCall<T>> {
    return this.send(systemPrompt(task, guidance), content, outputBudget(task).max, schema, map);
  }

  private async send<S extends z.ZodType, T>(
    instructions: string,
    content: InputContent[],
    maxOutputTokens: number,
    schema: S,
    map: (data: z.infer<S>) => T,
  ): Promise<AiCall<T>> {
    let response;
    try {
      response = await this.withRetry(() =>
        this.client.responses.parse({
          model: this.model,
          instructions,
          input: [{ role: "user", content }],
          max_output_tokens: maxOutputTokens,
          reasoning: { effort: "low" },
          text: { format: zodTextFormat(schema, "studio_result") },
        }),
      );
    } catch (error) {
      throw new AiCallError("AI_FAILED", describeError(error));
    }
    const usage: AiUsage = {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      usd: this.usd(response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0),
    };
    if (response.status === "incomplete") {
      throw new AiCallError("AI_INVALID_OUTPUT", "câu trả lời bị cắt vì quá dài", usage);
    }
    const refusal = response.output
      .flatMap((item) =>
        item.type === "message"
          ? item.content.flatMap((part) => (part.type === "refusal" ? [part.refusal] : []))
          : [],
      )
      .join("");
    if (refusal !== "") throw new AiCallError("AI_REFUSED", refusal, usage);
    if (response.output_parsed === null) {
      throw new AiCallError("AI_INVALID_OUTPUT", "không có structured output hợp lệ", usage);
    }
    const parsed = schema.safeParse(response.output_parsed);
    if (!parsed.success) throw new AiCallError("AI_INVALID_OUTPUT", "sai cấu trúc yêu cầu", usage);
    return { data: map(parsed.data), usage };
  }

  private async withRetry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await call();
      } catch (error) {
        if (
          !(error instanceof OpenAI.APIError) ||
          (error.status !== 429 && (error.status ?? 0) < 500) ||
          attempt >= MAX_RETRIES
        )
          throw error;
        await this.sleep((this.options.retryDelayMs ?? 1000) * 2 ** attempt);
      }
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof OpenAI.AuthenticationError) return "API key OpenAI không hợp lệ (OPENAI_API_KEY)";
  if (error instanceof OpenAI.PermissionDeniedError) return "API key OpenAI không có quyền dùng model này";
  if (error instanceof OpenAI.RateLimitError) return "OpenAI đang quá tải hoặc hết hạn mức, thử lại sau";
  if (error instanceof OpenAI.APIError) return `OpenAI ${String(error.status)}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
