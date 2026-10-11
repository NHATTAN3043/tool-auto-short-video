import { sceneVoiceStatus, type Project, type Scene } from "@studio/domain";

// What a scene still lacks before it is worth rendering. Display only: nothing here changes the project.

export interface SceneReadiness {
  /** Short Vietnamese label of what is missing, e.g. "Thiếu lời, media"; null when nothing is. */
  missing: string | null;
  /** The scene voice is older than its narration or voice settings. */
  voiceOutdated: boolean;
}

/**
 * `voiceRequired`: per-scene voices are expected (TTS configured and the voiceGeneration toggle on).
 * Without it a missing scene voice is normal (the project may use one voice file for the whole video).
 */
export function sceneReadiness(project: Project, scene: Scene, voiceRequired: boolean): SceneReadiness {
  const voice = sceneVoiceStatus(project, scene);
  const parts: string[] = [];
  if (voice === "empty") parts.push("lời");
  if (scene.media === undefined) parts.push("media");
  if (voiceRequired && voice === "missing") parts.push("giọng");
  return {
    missing: parts.length > 0 ? `Thiếu ${parts.join(", ")}` : null,
    voiceOutdated: voiceRequired && voice === "outdated",
  };
}

export function isSceneReady(readiness: SceneReadiness): boolean {
  return readiness.missing === null && !readiness.voiceOutdated;
}
