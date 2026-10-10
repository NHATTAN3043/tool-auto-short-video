import { z } from "zod";

import { AI_RANK_MAX_CANDIDATES, AI_SCRIPT_MAX_SECONDS, AI_SCRIPT_MIN_SECONDS } from "../ai/schema";
import { MediaCandidateSchema, MediaRankingModeSchema } from "../media/search";

// Full AI (M11b, ADR 0010): one worker job goes from an idea to scenes with media and voices, step by step
// as the automation toggles allow, then the user reviews every scene.

/** In run order. Which ones run depends on the toggles (fullAiSteps). */
export const FullAiStepSchema = z.enum(["script", "scenes", "visual", "media", "rank", "select", "voice"]);
export type FullAiStep = z.infer<typeof FullAiStepSchema>;

export const FullAiRequestSchema = z.object({
  /** Needed when the script step runs; otherwise the project's own script is used. */
  idea: z.string().trim().max(2000).optional(),
  targetDurationSec: z.number().int().min(AI_SCRIPT_MIN_SECONDS).max(AI_SCRIPT_MAX_SECONDS),
  tone: z.string().trim().max(200).optional(),
  rankingMode: MediaRankingModeSchema,
  /** The user confirmed that the current scenes are replaced. */
  replaceScenes: z.boolean(),
});
export type FullAiRequest = z.infer<typeof FullAiRequestSchema>;

/** Full AI part of a job: the request, its steps, the step running now and what it cost. */
export const FullAiJobInfoSchema = z.object({
  request: FullAiRequestSchema,
  steps: z.array(FullAiStepSchema).min(1),
  step: FullAiStepSchema.optional(),
  /** Worst case estimated before the run; every call is still checked by CostGuard. */
  maxUsd: z.number().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
});
export type FullAiJobInfo = z.infer<typeof FullAiJobInfoSchema>;

export const FULL_AI_MAX_WARNINGS = 50;

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
});
export type FullAiResult = z.infer<typeof FullAiResultSchema>;
