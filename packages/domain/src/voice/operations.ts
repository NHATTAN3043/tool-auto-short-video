import { DomainError } from "../errors";
import { addAsset } from "../media/operations";
import type { MediaAsset } from "../media/schema";
import type { Project } from "../project/schema";
import { VoiceSettingsSchema, VoiceTrackSchema, type VoiceSettings, type VoiceTrack } from "./schema";

/**
 * Adds a generated voice asset and makes it the scene's voice. The previous voice asset stays in the
 * project (non-destructive), only the reference moves.
 */
export function setSceneVoice(project: Project, sceneId: string, asset: MediaAsset): Project {
  if (asset.kind !== "audio") throw new DomainError("INVALID_MEDIA", "A scene voice must be an audio asset");
  const index = project.scenes.findIndex((scene) => scene.id === sceneId);
  if (index === -1) throw new DomainError("SCENE_NOT_FOUND", `Scene not found: ${sceneId}`);
  const withAsset = addAsset(project, asset);
  const scenes = withAsset.scenes.map((scene, i) =>
    i === index ? { ...scene, voiceAssetId: asset.id } : scene,
  );
  return { ...withAsset, scenes };
}

/** Sets how generated voices sound, or removes the settings with null. */
export function setVoiceSettings(project: Project, settings: VoiceSettings | null): Project {
  if (settings === null) {
    const next = { ...project };
    delete next.voice;
    return next;
  }
  const parsed = VoiceSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    throw new DomainError("INVALID_INPUT", parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return { ...project, voice: parsed.data };
}

/** Chooses which voice track plays when the project has both a whole-video voice and scene voices. */
export function setVoiceTrack(project: Project, track: VoiceTrack): Project {
  return { ...project, voiceTrack: VoiceTrackSchema.parse(track) };
}

/** Defaults of ElevenLabs' own voice settings. */
export const DEFAULT_VOICE_TUNING = { stability: 0.5, similarityBoost: 0.75, speed: 1 } as const;

/**
 * Settings a project starts from: the configured default voice and model, else the first ones of the
 * provider account. Null when the account has no voice.
 */
export function initialVoiceSettings(source: {
  provider: string;
  defaults: { modelId?: string; voiceId?: string } | null;
  voices: readonly { id: string }[];
  models: readonly { id: string }[];
}): VoiceSettings | null {
  const voiceId = source.defaults?.voiceId ?? source.voices[0]?.id;
  const modelId = source.defaults?.modelId ?? source.models[0]?.id;
  if (voiceId === undefined || modelId === undefined) return null;
  return { provider: source.provider, voiceId, modelId, ...DEFAULT_VOICE_TUNING };
}
