import { z } from "zod";

import { AiConfigSchema } from "../ai/config";
import {
  AI_RANK_MAX_CANDIDATES,
  AI_SCRIPT_MAX_SECONDS,
  AI_SCRIPT_MIN_SECONDS,
  SourcePartSchema,
  SourceScriptSchema,
} from "../ai/schema";
import { MediaCandidateSchema, MediaRankingModeSchema } from "../media/search";
import { VisualPlanSchema } from "../scene/schema";
import { SkillIdSchema } from "../skill/schema";
import { ContentLanguageSchema } from "../text/language";

// Full AI (M11b, ADR 0010): one worker job goes from an idea to scenes with media and voices, step by step
// as the automation toggles allow, then the user reviews every scene.

/**
 * In run order. Which ones run depends on the toggles (fullAiSteps); a run on a source video (ADR 0020)
 * takes `analyze` and `cut` instead of the script, scene and media steps.
 */
export const FullAiStepSchema = z.enum([
  "script",
  "scenes",
  "visual",
  "media",
  "rank",
  "select",
  "analyze",
  "cut",
  "voice",
]);
export type FullAiStep = z.infer<typeof FullAiStepSchema>;

/**
 * The script outline the user approved (ADR 0015): the run applies these scenes word for word instead of
 * writing and splitting a script. A scene without a visual plan (added or edited) gets one from the AI.
 */
export const FullAiOutlineSchema = z.object({
  title: z.string().trim().max(300),
  scenes: z
    .array(
      z.object({
        narration: z.string().trim().min(1).max(5000),
        visualPlan: VisualPlanSchema.optional(),
      }),
    )
    .min(1)
    .max(100),
});
export type FullAiOutline = z.infer<typeof FullAiOutlineSchema>;

export const SourceVideoSchema = z.object({
  assetId: z.string().min(1),
  /** Original clip audio; 0 mutes it, 1 keeps its full level. */
  volume: z.number().min(0).max(1),
  script: SourceScriptSchema.optional(),
  /** Opening hook and closing call to action; missing = none. */
  hook: SourcePartSchema.optional(),
  outro: SourcePartSchema.optional(),
});
export type SourceVideo = z.infer<typeof SourceVideoSchema>;

export const FullAiRequestSchema = z.object({
  /** Needed when the script step runs; otherwise the project's own script is used. */
  idea: z.string().trim().max(2000).optional(),
  targetDurationSec: z.number().int().min(AI_SCRIPT_MIN_SECONDS).max(AI_SCRIPT_MAX_SECONDS),
  tone: z.string().trim().max(200).optional(),
  rankingMode: MediaRankingModeSchema,
  /**
   * Tell the story along one uploaded project video (ADR 0020) instead of searching and assembling media:
   * the AI keeps runs of its shots in order and writes their narration.
   */
  sourceVideo: SourceVideoSchema.optional(),
  /** Skill sent with the script and keyword steps (ADR 0012). */
  skillId: SkillIdSchema.optional(),
  /** Saved as the project language when the run starts (ADR 0013); absent keeps the project's. */
  language: ContentLanguageSchema.optional(),
  /** Approved outline; with it the idea is only context and no script is written. */
  outline: FullAiOutlineSchema.optional(),
  /** The user confirmed that the current scenes are replaced. */
  replaceScenes: z.boolean(),
});
export type FullAiRequest = z.infer<typeof FullAiRequestSchema>;

/** Full AI part of a job: the request, its steps, the step running now and what it cost. */
export const FullAiJobInfoSchema = z.object({
  request: FullAiRequestSchema,
  /** Optional so queued jobs written before multi-provider AI stay readable. */
  config: AiConfigSchema.optional(),
  steps: z.array(FullAiStepSchema).min(1),
  step: FullAiStepSchema.optional(),
  /** Worst case estimated before the run; every call is still checked by CostGuard. */
  maxUsd: z.number().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
});
export type FullAiJobInfo = z.infer<typeof FullAiJobInfoSchema>;

export const FULL_AI_MAX_WARNINGS = 50;

/**
 * Why a scene was left without media: no candidate was found, the AI rejected every one, or a usable one
 * could not be added (a download or copy failed).
 */
export const MissingSceneReasonSchema = z.enum(["no_candidates", "all_rejected", "not_assigned"]);
export type MissingSceneReason = z.infer<typeof MissingSceneReasonSchema>;

/** A scene the user still has to find media for, with what to look for (ADR 0019). */
export const MissingSceneSchema = z.object({
  sceneId: z.string().min(1),
  reason: MissingSceneReasonSchema,
  /** What the picture should show, from the scene's visual plan; empty when it has none. */
  intent: z.string(),
  queries: z.object({ en: z.array(z.string()), vi: z.array(z.string()), zh: z.array(z.string()) }),
});
export type MissingScene = z.infer<typeof MissingSceneSchema>;

/** Stored as `full-ai/<jobId>.json`: the ranked candidates per scene, for "Đổi media" on the review screen. */
export const FullAiResultSchema = z.object({
  scenes: z.array(
    z.object({
      sceneId: z.string().min(1),
      /** Best first. */
      candidates: z.array(MediaCandidateSchema).max(AI_RANK_MAX_CANDIDATES),
    }),
  ),
  /** Things that did not work but did not stop the run (a provider down, a voice that failed…). */
  warnings: z.array(z.string().max(500)).max(FULL_AI_MAX_WARNINGS),
  /** Optional so results saved before ADR 0019 stay valid. */
  missingScenes: z.array(MissingSceneSchema).optional(),
});
export type FullAiResult = z.infer<typeof FullAiResultSchema>;
