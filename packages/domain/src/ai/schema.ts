import { z } from "zod";

import { MAX_SHOTS, SHOT_DESCRIPTION_MAX_LENGTH } from "../media/clip-analysis";
import { MediaLinkSchema, MediaRankingModeSchema } from "../media/search";
import { VisualPlanSchema } from "../scene/schema";
import { SkillIdSchema } from "../skill/schema";
import { ContentLanguageSchema } from "../text/language";
import { AiConfigSchema } from "./config";

// What the studio asks an AI provider and what it gets back. Results are suggestions: they are shown for
// review and only change the project when the user applies them.

/** Any whole number of seconds the user types, above 0 and below 1000. */
export const AI_SCRIPT_MIN_SECONDS = 1;
export const AI_SCRIPT_MAX_SECONDS = 999;
/** Per language. The AI is asked for at least AI_MIN_SEARCH_QUERIES of each. */
export const AI_MAX_SEARCH_QUERIES = 6;
export const AI_MIN_SEARCH_QUERIES = 3;

export const ScriptRequestSchema = z.object({
  idea: z.string().trim().min(3).max(2000),
  targetDurationSec: z.number().int().min(AI_SCRIPT_MIN_SECONDS).max(AI_SCRIPT_MAX_SECONDS),
  /** Free text: "hài hước", "truyền cảm hứng"… */
  tone: z.string().trim().max(200).optional(),
  /** Skill sent along as expert notes (ADR 0012). */
  skillId: SkillIdSchema.optional(),
  /** Language of the narration (ADR 0013); filled from the project by the server. Absent = Vietnamese. */
  language: ContentLanguageSchema.optional(),
});
export type ScriptRequest = z.infer<typeof ScriptRequestSchema>;

export const ScenePlanRequestSchema = z.object({
  script: z.string().trim().min(1).max(20_000),
  maxWordsPerScene: z.number().int().min(5).max(60),
  /** Only shapes the visual suggestions: the narration is kept word for word. */
  skillId: SkillIdSchema.optional(),
  /** The script's language, so the split never translates it. */
  language: ContentLanguageSchema.optional(),
});
export type ScenePlanRequest = z.infer<typeof ScenePlanRequestSchema>;

export const VisualPlanRequestSchema = z.object({
  /** Whole script, for context. */
  script: z.string().max(20_000),
  scenes: z
    .array(z.object({ id: z.string().min(1), narration: z.string().max(5000) }))
    .min(1)
    .max(100),
  skillId: SkillIdSchema.optional(),
  /**
   * Asked from one scene's media search: a click of the user, not an automation, so it runs whatever the
   * visualKeywords toggle says. Only for a single scene; the bulk and Full AI steps follow the toggle.
   */
  onDemand: z.boolean().optional(),
});
export type VisualPlanRequest = z.infer<typeof VisualPlanRequestSchema>;

/** Candidates per scene sent to the AI for ranking: each one may be an image in vision mode. */
export const AI_RANK_MAX_CANDIDATES = 10;
/**
 * Of those, at most this many are own files (project uploads, shared library), so a weak own match always
 * meets stock to be compared against.
 */
export const AI_RANK_MAX_OWN = 5;
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
  skillId: SkillIdSchema.optional(),
  language: ContentLanguageSchema.optional(),
});
export type SceneRewriteRequest = z.infer<typeof SceneRewriteRequestSchema>;

/** At most this many questions in one round, each with at most AI_BRIEF_MAX_OPTIONS options. */
export const AI_BRIEF_MAX_QUESTIONS = 5;
export const AI_BRIEF_MAX_OPTIONS = 5;

/** Full AI asks before writing (ADR 0015): same inputs as the script, the answer is questions. */
export const BriefQuestionsRequestSchema = ScriptRequestSchema;
export type BriefQuestionsRequest = z.infer<typeof BriefQuestionsRequestSchema>;

export const BriefAnswerSchema = z.object({
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(500),
});
export type BriefAnswer = z.infer<typeof BriefAnswerSchema>;

export const ScriptOutlineRequestSchema = ScriptRequestSchema.extend({
  /** Only the questions the user answered; the AI decides the rest. */
  answers: z.array(BriefAnswerSchema).max(AI_BRIEF_MAX_QUESTIONS),
  /** "Làm lại": the narration of the outline being replaced and what to change in it. */
  revision: z
    .object({
      feedback: z.string().trim().min(1).max(500),
      scenes: z.array(z.string().max(5000)).min(1).max(100),
    })
    .optional(),
});
export type ScriptOutlineRequest = z.infer<typeof ScriptOutlineRequestSchema>;

/**
 * A script the user gives with a source video (ADR 0020): the original dialogue or subtitles, only to
 * understand the video (`reference`), or the narration to read, kept sentence for sentence (`narration`).
 */
export const SourceScriptRoleSchema = z.enum(["reference", "narration"]);
export type SourceScriptRole = z.infer<typeof SourceScriptRoleSchema>;
export const SourceScriptSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  role: SourceScriptRoleSchema,
});
export type SourceScript = z.infer<typeof SourceScriptSchema>;

/**
 * Where the picture of the opening hook or the closing call to action comes from (ADR 0020): none, a
 * stretch of the source video, or a video or image of the project.
 */
export const SourcePartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("source") }),
  z.object({ kind: z.literal("asset"), assetId: z.string().min(1) }),
]);
export type SourcePart = z.infer<typeof SourcePartSchema>;

/** A hook or an ending as the AI is told about it: cut from the source, or a clip of that length (none for an image). */
export const SourceCutPartRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("source") }),
  z.object({ kind: z.literal("clip"), durationMs: z.number().int().positive().optional() }),
]);
export type SourceCutPartRequest = z.infer<typeof SourceCutPartRequestSchema>;

/**
 * Full AI on one source video (ADR 0020): the analyzed shots in time order. The AI tells the main part as
 * one long scene (a few only when the content changes), in shot order, and writes the hook and the ending
 * when asked; the video then speeds up or slows down a little to end with each voice (ADR 0021).
 */
export const SourceCutRequestSchema = z.object({
  /** What the user wants the video to say; may be empty when a script is given. */
  idea: z.string().trim().max(2000),
  targetDurationSec: z.number().int().min(AI_SCRIPT_MIN_SECONDS).max(AI_SCRIPT_MAX_SECONDS),
  tone: z.string().trim().max(200).optional(),
  durationMs: z.number().int().positive(),
  shots: z
    .array(
      z.object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive(),
        description: z.string().max(SHOT_DESCRIPTION_MAX_LENGTH),
        textOverlay: z.boolean(),
      }),
    )
    .min(1)
    .max(MAX_SHOTS),
  script: SourceScriptSchema.optional(),
  hook: SourceCutPartRequestSchema.optional(),
  outro: SourceCutPartRequestSchema.optional(),
  skillId: SkillIdSchema.optional(),
  language: ContentLanguageSchema.optional(),
});
export type SourceCutRequest = z.infer<typeof SourceCutRequestSchema>;

export const AiTaskSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("script"), input: ScriptRequestSchema }),
  z.object({ type: z.literal("scenes"), input: ScenePlanRequestSchema }),
  z.object({ type: z.literal("visual"), input: VisualPlanRequestSchema }),
  z.object({ type: z.literal("rank_media"), input: MediaRankRequestSchema }),
  z.object({ type: z.literal("rewrite_scene"), input: SceneRewriteRequestSchema }),
  z.object({ type: z.literal("brief_questions"), input: BriefQuestionsRequestSchema }),
  z.object({ type: z.literal("script_outline"), input: ScriptOutlineRequestSchema }),
  z.object({ type: z.literal("source_cut"), input: SourceCutRequestSchema }),
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

/**
 * Candidate keys of each scene, best first. `rejected` are the keys the AI says do not fit the scene at
 * all; they stay in `keys` (last) so the user can still pick them by hand.
 */
export const MediaRankingSuggestionSchema = z.object({
  scenes: z.array(
    z.object({
      sceneId: z.string().min(1),
      keys: z.array(z.string().min(1)),
      rejected: z.array(z.string().min(1)).optional(),
    }),
  ),
});
export type MediaRankingSuggestion = z.infer<typeof MediaRankingSuggestionSchema>;

export const SceneRewriteSuggestionSchema = z.object({ narration: z.string().min(1) });
export type SceneRewriteSuggestion = z.infer<typeof SceneRewriteSuggestionSchema>;

/** `text` questions have no options; the others offer 2+ and always allow a free answer. */
export const BriefQuestionKindSchema = z.enum(["single", "multi", "text"]);
export type BriefQuestionKind = z.infer<typeof BriefQuestionKindSchema>;

export const BriefQuestionSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().min(1).max(300),
  kind: BriefQuestionKindSchema,
  options: z.array(z.string().min(1).max(120)).max(AI_BRIEF_MAX_OPTIONS),
});
export type BriefQuestion = z.infer<typeof BriefQuestionSchema>;

/** No questions is a valid answer: the idea was clear enough. */
export const BriefQuestionsSuggestionSchema = z.object({
  questions: z.array(BriefQuestionSchema).max(AI_BRIEF_MAX_QUESTIONS),
});
export type BriefQuestionsSuggestion = z.infer<typeof BriefQuestionsSuggestionSchema>;

/** Narration and visual plan per scene, like a scene plan, plus the title. */
export const ScriptOutlineSuggestionSchema = ScenePlanSuggestionSchema.extend({ title: z.string() });
export type ScriptOutlineSuggestion = z.infer<typeof ScriptOutlineSuggestionSchema>;

/** A run of shots: 0-based indexes of the request, inclusive. */
const SourceCutRunSchema = z.object({
  fromShot: z.number().int().nonnegative(),
  toShot: z.number().int().nonnegative(),
  /** Empty lets the original moment play without narration. */
  narration: z.string(),
});

/** A hook or an ending: its narration, and its shots when it is cut from the source. */
const SourceCutExtraSchema = z.object({
  narration: z.string(),
  fromShot: z.number().int().nonnegative().optional(),
  toShot: z.number().int().nonnegative().optional(),
});

/** The hook, the main part as runs of shots in time order (usually one), and the ending. */
export const SourceCutSuggestionSchema = z.object({
  title: z.string(),
  hook: SourceCutExtraSchema.optional(),
  main: z.array(SourceCutRunSchema).min(1),
  outro: SourceCutExtraSchema.optional(),
});
export type SourceCutSuggestion = z.infer<typeof SourceCutSuggestionSchema>;

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
  z.object({
    type: z.literal("brief_questions"),
    suggestion: BriefQuestionsSuggestionSchema,
    usage: AiUsageSchema,
  }),
  z.object({
    type: z.literal("script_outline"),
    suggestion: ScriptOutlineSuggestionSchema,
    usage: AiUsageSchema,
  }),
  z.object({
    type: z.literal("source_cut"),
    suggestion: SourceCutSuggestionSchema,
    usage: AiUsageSchema,
  }),
]);
export type AiResult = z.infer<typeof AiResultSchema>;

/** AI part of a job: what to do, the most it may cost (reserved against the daily limit) and what it cost. */
export const AiJobInfoSchema = z.object({
  task: AiTaskSchema,
  /** Optional so jobs written before multi-provider AI stay readable. */
  config: AiConfigSchema.optional(),
  maxUsd: z.number().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
});
export type AiJobInfo = z.infer<typeof AiJobInfoSchema>;
