import { z } from "zod";

/** How generated scene voices sound. Part of the voice content hash, so changing it marks voices outdated. */
export const VoiceSettingsSchema = z.object({
  /** TTS port id, e.g. "elevenlabs". */
  provider: z.string().min(1),
  voiceId: z.string().min(1),
  modelId: z.string().min(1),
  stability: z.number().min(0).max(1),
  similarityBoost: z.number().min(0).max(1),
  speed: z.number().min(0.7).max(1.2),
});
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

/**
 * Which narration is heard when a project has both a whole-video voice and per-scene voices. Only one
 * track ever plays, so the two never overlap; the other references stay stored and can be switched back.
 */
export const VoiceTrackSchema = z.enum(["project", "scenes"]);
export type VoiceTrack = z.infer<typeof VoiceTrackSchema>;
