import { z } from "zod";

import { MediaLinkSchema, MediaRankingModeSchema } from "../media/search";
import { VisualPlanSchema } from "../scene/schema";

// What the studio asks an AI provider and what it gets back. Results are suggestions: they are shown for
// review and only change the project when the user applies them.

export const AI_SCRIPT_MIN_SECONDS = 15;
export const AI_SCRIPT_MAX_SECONDS = 180;
/** Per language. The AI is asked for at least AI_MIN_SEARCH_QUERIES of each. */
export const AI_MAX_SEARCH_QUERIES = 6;
export const AI_MIN_SEARCH_QUERIES = 3;

export const ScriptRequestSchema = z.object({
  idea: z.string().trim().min(3).max(2000),
  targetDurationSec: z.number().int().min(AI_SCRIPT_MIN_SECONDS).max(AI_SCRIPT_MAX_SECONDS),
  /** Free text: "hài hước", "truyền cảm hứng"… */
  tone: z.string().trim().max(200).optional(),
});
export type ScriptRequest = z.infer<typeof ScriptRequestSchema>;

export const ScenePlanRequestSchema = z.object({
  script: z.string().trim().min(1).max(20_000),
  maxWordsPerScene: z.number().int().min(5).max(60),
});
export type ScenePlanRequest = z.infer<typeof ScenePlanRequestSchema>;

export const VisualPlanRequestSchema = z.object({
  /** Whole script, for context. */
  script: z.string().max(20_000),
  scenes: z
    .array(z.object({ id: z.string().min(1), narration: z.string().max(5000) }))
    .min(1)
    .max(100),
});
export type VisualPlanRequest = z.infer<typeof VisualPlanRequestSchema>;

/** Candidates per scene sent to the AI for ranking: each one may be an image in vision mode. */
export const AI_RANK_MAX_CANDIDATES = 6;
/** Scenes per ranking call; vision calls stay under the API's limit on images per request. */
export const AI_RANK_MAX_SCENES = 15;

export const RankCandidateSchema = z.object({
  /** candidateKey(): `pexels:video:123`. */
  key: z.string().min(1).max(200),
  kind: z.enum(["video", "image"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().nonnegative().optional(),
  description: z.string().max(500).optional(),
  /** Looked at in vision mode; the server resolves it to an image, never the browser. */
  thumbnail: MediaLinkSchema,
});
export type RankCandidate = z.infer<typeof RankCandidateSchema>;

export const MediaRankRequestSchema = z.object({
  mode: MediaRankingModeSchema,
  scenes: z
    .array(
      z.object({
        sceneId: z.string().min(1),
        narration: z.string().max(5000),
        intent: z.string().max(500).optional(),
        candidates: z.array(RankCandidateSchema).min(1).max(AI_RANK_MAX_CANDIDATES),
      }),
    )
    .min(1)
    .max(AI_RANK_MAX_SCENES),
});
export type MediaRankRequest = z.infer<typeof MediaRankRequestSchema>;

export const SceneRewriteRequestSchema = z.object({
  /** Whole script, for context. */
  script: z.string().max(20_000),
  narration: z.string().trim().min(1).max(5000),
  /** Free text: "ngắn hơn", "hài hước hơn"… */
  instruction: z.string().trim().max(300).optional(),
});
export type SceneRewriteRequest = z.infer<typeof SceneRewriteRequestSchema>;

export const AiTaskSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("script"), input: ScriptRequestSchema }),
  z.object({ type: z.literal("scenes"), input: ScenePlanRequestSchema }),
  z.object({ type: z.literal("visual"), input: VisualPlanRequestSchema }),
  z.object({ type: z.literal("rank_media"), input: MediaRankRequestSchema }),
  z.object({ type: z.literal("rewrite_scene"), input: SceneRewriteRequestSchema }),
]);
export type AiTask = z.infer<typeof AiTaskSchema>;
export type AiTaskType = AiTask["type"];

export const ScriptSuggestionSchema = z.object({ title: z.string(), script: z.string().min(1) });
export type ScriptSuggestion = z.infer<typeof ScriptSuggestionSchema>;

export const SceneSuggestionSchema = z.object({ narration: z.string().min(1), visualPlan: VisualPlanSchema });
export const ScenePlanSuggestionSchema = z.object({ scenes: z.array(SceneSuggestionSchema).min(1) });
export type ScenePlanSuggestion = z.infer<typeof ScenePlanSuggestionSchema>;

export const VisualPlansSuggestionSchema = z.object({
  plans: z.array(z.object({ sceneId: z.string().min(1), visualPlan: VisualPlanSchema })).min(1),
});
export type VisualPlansSuggestion = z.infer<typeof VisualPlansSuggestionSchema>;

/** Candidate keys of each scene, best first. */
export const MediaRankingSuggestionSchema = z.object({
  scenes: z.array(z.object({ sceneId: z.string().min(1), keys: z.array(z.string().min(1)) })),
});
export type MediaRankingSuggestion = z.infer<typeof MediaRankingSuggestionSchema>;

export const SceneRewriteSuggestionSchema = z.object({ narration: z.string().min(1) });
export type SceneRewriteSuggestion = z.infer<typeof SceneRewriteSuggestionSchema>;

export const AiUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  usd: z.number().nonnegative(),
});
export type AiUsage = z.infer<typeof AiUsageSchema>;

/** Stored result of a finished AI job, read back by the UI for review. */
export const AiResultSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("script"), suggestion: ScriptSuggestionSchema, usage: AiUsageSchema }),
  z.object({ type: z.literal("scenes"), suggestion: ScenePlanSuggestionSchema, usage: AiUsageSchema }),
  z.object({ type: z.literal("visual"), suggestion: VisualPlansSuggestionSchema, usage: AiUsageSchema }),
  z.object({
    type: z.literal("rank_media"),
    suggestion: MediaRankingSuggestionSchema,
    usage: AiUsageSchema,
  }),
  z.object({
    type: z.literal("rewrite_scene"),
    suggestion: SceneRewriteSuggestionSchema,
    usage: AiUsageSchema,
  }),
]);
export type AiResult = z.infer<typeof AiResultSchema>;

/** AI part of a job: what to do, the most it may cost (reserved against the daily limit) and what it cost. */
export const AiJobInfoSchema = z.object({
  task: AiTaskSchema,
  maxUsd: z.number().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
});
export type AiJobInfo = z.infer<typeof AiJobInfoSchema>;
