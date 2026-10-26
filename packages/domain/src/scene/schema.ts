import { z } from "zod";

export const MediaFitSchema = z.enum(["cover", "contain"]);
export type MediaFit = z.infer<typeof MediaFitSchema>;

/** Slowest and fastest a scene video may play (ADR 0021); Full AI keeps to a narrower range. */
export const SCENE_PLAYBACK_RATE_MIN = 0.5;
export const SCENE_PLAYBACK_RATE_MAX = 2;

/** Non-destructive: only references a segment of an asset, the file itself is never touched. */
export const SceneMediaSchema = z
  .object({
    assetId: z.string().min(1),
    sourceStartMs: z.number().int().nonnegative(),
    /** Missing = play until the scene ends, looping if the source is shorter. */
    sourceEndMs: z.number().int().positive().optional(),
    /** `contain` renders a blurred cover copy behind the media. */
    fit: MediaFitSchema,
    /** 0..1 horizontal crop position when a landscape source is cut to 9:16. */
    focusX: z.number().min(0).max(1),
    /** Original clip audio; 0 by default so it never drowns the narration. */
    volume: z.number().min(0).max(1),
    kenBurns: z.boolean(),
    /**
     * Video speed (ADR 0021): 1.1 plays the segment 10% faster, so it lasts 1/1.1 as long. Missing = 1.
     * Manual changes and the editor's voice fit preserve scene duration; Full AI may also fit duration.
     */
    playbackRate: z.number().min(SCENE_PLAYBACK_RATE_MIN).max(SCENE_PLAYBACK_RATE_MAX).optional(),
  })
  .refine((media) => media.sourceEndMs === undefined || media.sourceEndMs > media.sourceStartMs, {
    message: "sourceEndMs must be greater than sourceStartMs",
    path: ["sourceEndMs"],
  });
export type SceneMedia = z.infer<typeof SceneMediaSchema>;

/** Longest offset accepted for a sound effect inside its scene; matches the longest manual scene. */
export const MAX_SFX_OFFSET_MS = 600_000;

/** A sound effect played once, `offsetMs` after its scene starts. It may ring on into the next scene. */
export const SceneSfxSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  offsetMs: z.number().int().nonnegative().max(MAX_SFX_OFFSET_MS),
  volume: z.number().min(0).max(1),
});
export type SceneSfx = z.infer<typeof SceneSfxSchema>;

/** Search keywords in languages other than English, for the stock search and for searching elsewhere. */
export const LocalizedQueriesSchema = z.object({
  vi: z.array(z.string()),
  zh: z.array(z.string()),
});
export type LocalizedQueries = z.infer<typeof LocalizedQueriesSchema>;

export const VisualPlanSchema = z.object({
  intent: z.string(),
  preferredMedia: z.enum(["video", "image"]),
  /** English keywords: stock libraries search best in English. */
  searchQueries: z.array(z.string()),
  /** Optional so plans written before M10 (English only) stay valid. */
  localizedQueries: LocalizedQueriesSchema.optional(),
});
export type VisualPlan = z.infer<typeof VisualPlanSchema>;

export const SceneStatusSchema = z.enum(["draft", "ready", "approved"]);
export type SceneStatus = z.infer<typeof SceneStatusSchema>;

export const SceneSchema = z.object({
  id: z.string().min(1),
  narration: z.string(),
  /** Manual duration; missing = computed by the timeline. */
  durationMs: z.number().int().positive().optional(),
  /** Per-scene voice (TTS); takes precedence over the project voice for this scene's duration. */
  voiceAssetId: z.string().min(1).optional(),
  media: SceneMediaSchema.optional(),
  /** Optional so v1 files written before sound effects existed stay valid. */
  sfx: z.array(SceneSfxSchema).optional(),
  visualPlan: VisualPlanSchema.optional(),
  status: SceneStatusSchema,
});
export type Scene = z.infer<typeof SceneSchema>;
