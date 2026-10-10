import type { Project } from "../project/schema";
import type { Scene } from "../scene/schema";
import { narrationForSpeech, voiceContentHash } from "./content-hash";
import type { VoiceTrack } from "./schema";

/**
 * - `empty`: nothing to say, no voice can be generated.
 * - `missing`: no scene voice yet.
 * - `current`: a generated voice matching the narration and the project voice settings.
 * - `outdated`: a generated voice made from older narration or settings.
 * - `uploaded`: a voice the user supplied; never replaced by generation.
 */
export type SceneVoiceStatus = "empty" | "missing" | "current" | "outdated" | "uploaded";

export function sceneVoiceStatus(project: Project, scene: Scene): SceneVoiceStatus {
  if (narrationForSpeech(scene.narration) === "") return "empty";
  if (scene.voiceAssetId === undefined) return "missing";
  const asset = project.assets.find((candidate) => candidate.id === scene.voiceAssetId);
  if (!asset) return "missing";
  if (asset.source !== "tts") return "uploaded";
  if (project.voice === undefined) return "current";
  return asset.contentHash === voiceContentHash(scene.narration, project.voice) ? "current" : "outdated";
}

/** Scenes a "generate changed voices" run would produce: missing or outdated, in scene order. */
export function scenesNeedingVoice(project: Project, sceneIds?: readonly string[]): string[] {
  const wanted = sceneIds === undefined ? null : new Set(sceneIds);
  return project.scenes
    .filter((scene) => wanted === null || wanted.has(scene.id))
    .filter((scene) => {
      const status = sceneVoiceStatus(project, scene);
      return status === "missing" || status === "outdated";
    })
    .map((scene) => scene.id);
}

/**
 * The narration track that plays: when only one kind of voice exists it is that one; when both exist,
 * the user's choice (`project.voiceTrack`), defaulting to the whole-video voice. Null without any voice.
 */
export function activeVoiceTrack(project: Project): VoiceTrack | null {
  const hasProjectVoice = project.voiceAssetId !== undefined;
  const hasSceneVoices = project.scenes.some((scene) => scene.voiceAssetId !== undefined);
  if (hasProjectVoice && hasSceneVoices) return project.voiceTrack ?? "project";
  if (hasProjectVoice) return "project";
  if (hasSceneVoices) return "scenes";
  return null;
}

/** True when the user has to pick which voice track to keep. */
export function hasVoiceConflict(project: Project): boolean {
  return (
    project.voiceAssetId !== undefined && project.scenes.some((scene) => scene.voiceAssetId !== undefined)
  );
}
