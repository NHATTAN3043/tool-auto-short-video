import { z } from "zod";

import { MediaAssetSchema } from "../media/schema";
import { MediaRankingModeSchema } from "../media/search";
import { SceneSchema } from "../scene/schema";
import { SkillIdSchema } from "../skill/schema";
import { ContentLanguageSchema } from "../text/language";
import { VoiceSettingsSchema, VoiceTrackSchema } from "../voice/schema";

export const PROJECT_SCHEMA_VERSION = 1;

export const AutomationModeSchema = z.enum(["manual", "assisted", "full_ai"]);
export type AutomationMode = z.infer<typeof AutomationModeSchema>;

/** The real feature switches. A mode is only a preset of these; code never branches on the mode name. */
export const AutomationSettingsSchema = z.object({
  scriptGeneration: z.boolean(),
  scenePlanning: z.boolean(),
  visualKeywords: z.boolean(),
  voiceGeneration: z.boolean(),
  mediaSearch: z.boolean(),
  mediaRanking: z.boolean(),
  autoMediaSelection: z.boolean(),
});
export type AutomationSettings = z.infer<typeof AutomationSettingsSchema>;

export const CaptionStyleSchema = z.object({
  enabled: z.boolean(),
  /** 0..1 of the frame height; 0.62 stays clear of the TikTok/Reels/Shorts bottom UI. */
  positionY: z.number().min(0).max(1),
  fontSize: z.number().int().positive(),
  maxWordsPerCaption: z.number().int().min(1),
  uppercase: z.boolean(),
  color: z.string().min(1),
});
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

export const TransitionSchema = z.enum(["none", "fade"]);
export type Transition = z.infer<typeof TransitionSchema>;

export const ProjectStyleSchema = z.object({
  captions: CaptionStyleSchema,
  transition: TransitionSchema,
  transitionMs: z.number().int().nonnegative(),
  background: z.string().min(1),
});
export type ProjectStyle = z.infer<typeof ProjectStyleSchema>;

export const MusicSchema = z.object({
  assetId: z.string().min(1),
  volume: z.number().min(0).max(1),
});
export type Music = z.infer<typeof MusicSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  mode: AutomationModeSchema,
  automationSettings: AutomationSettingsSchema,
  width: z.literal(1080),
  height: z.literal(1920),
  fps: z.literal(30),
  script: z.string(),
  scenes: z.array(SceneSchema),
  assets: z.array(MediaAssetSchema),
  /** One voice file for the whole video (Manual mode). */
  voiceAssetId: z.string().min(1).optional(),
  /** How generated scene voices sound. Optional so v1 files written before TTS stay valid. */
  voice: VoiceSettingsSchema.optional(),
  /** Which voice plays when both a project voice and scene voices exist; see activeVoiceTrack. */
  voiceTrack: VoiceTrackSchema.optional(),
  music: MusicSchema.optional(),
  /** Ranking mode chosen last for Full AI; optional so older files stay valid. */
  mediaRankingMode: MediaRankingModeSchema.optional(),
  /** Skill chosen last for Full AI and rewrites (ADR 0012); optional so older files stay valid. */
  aiSkillId: SkillIdSchema.optional(),
  /** What the narration is written and read in (ADR 0013); absent = Vietnamese, so older files stay valid. */
  language: ContentLanguageSchema.optional(),
  style: ProjectStyleSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;
