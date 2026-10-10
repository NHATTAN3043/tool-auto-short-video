import { z } from "zod";

import { AiJobInfoSchema } from "../ai/schema";
import { FullAiJobInfoSchema } from "../full-ai/schema";

export const RenderJobStatusSchema = z.enum(["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]);
export type RenderJobStatus = z.infer<typeof RenderJobStatusSchema>;

/**
 * `video`: the finished MP4. `capcut`: a ZIP of separate tracks to keep editing in CapCut.
 * `tts`: generates the voices of `sceneIds`; it has no output file.
 * `ai`: runs `ai.task`; `outputPath` is the JSON suggestion for the user to review.
 * `full_ai`: runs the Full AI steps on the project; `outputPath` is the ranked media for the review screen.
 */
export const RenderJobKindSchema = z.enum(["video", "capcut", "tts", "ai", "full_ai"]);
export type RenderJobKind = z.infer<typeof RenderJobKindSchema>;

export const RenderJobSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** Missing on jobs from before the CapCut export; those are videos. */
  kind: RenderJobKindSchema.optional(),
  /** Scenes a `tts` job generates voices for. */
  sceneIds: z.array(z.string().min(1)).min(1).optional(),
  /** Task, cost reservation and real cost of an `ai` job. */
  ai: AiJobInfoSchema.optional(),
  /** Request, steps and cost of a `full_ai` job. */
  fullAi: FullAiJobInfoSchema.optional(),
  status: RenderJobStatusSchema,
  /** 0..1 */
  progress: z.number().min(0).max(1),
  /** MP4 (video), ZIP (capcut) or JSON (ai), relative to the project folder. */
  outputPath: z.string().min(1).optional(),
  /** Captions of the same render as SRT, relative to the project folder. Missing on jobs from before M7. */
  srtPath: z.string().min(1).optional(),
  errorMessage: z.string().optional(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
});
export type RenderJob = z.infer<typeof RenderJobSchema>;
