import { DomainError } from "../errors";
import type { Project } from "../project/schema";
import { scenePauseMs } from "../timeline/scene-pause";
import { updateScene, updateSceneMedia } from "./operations";

// A video scene that should end with its voice (ADR 0021): the video plays a little faster or slower so its
// segment lasts as long as the voice, instead of the voice being cut or trailing into silence.

/** The range kept to: outside it speech-heavy footage starts to look sped up or slowed down. */
export const FIT_SPEED_MIN = 0.8;
export const FIT_SPEED_MAX = 1.25;

export interface SpeedFit {
  playbackRate: number;
  /** How long the segment lasts at that rate: the scene's length. */
  durationMs: number;
  /**
   * `voice_longer`: even at the slowest speed the video ends first, so the end of the voice is cut.
   * `voice_shorter`: even at the fastest speed the video runs on after the voice, with its own sound only.
   */
  mismatch?: "voice_longer" | "voice_shorter";
}

/** The speed that makes `spanMs` of video last `targetMs`, kept within FIT_SPEED_MIN..FIT_SPEED_MAX. */
export function fitSourceSpeed(spanMs: number, targetMs: number): SpeedFit {
  if (spanMs <= 0 || targetMs <= 0) throw new DomainError("INVALID_INPUT", "Lengths must be positive");
  const wanted = spanMs / targetMs;
  const playbackRate = Math.round(Math.min(FIT_SPEED_MAX, Math.max(FIT_SPEED_MIN, wanted)) * 1000) / 1000;
  const durationMs = Math.round(spanMs / playbackRate);
  const fit: SpeedFit = { playbackRate, durationMs };
  if (wanted < FIT_SPEED_MIN) fit.mismatch = "voice_longer";
  else if (wanted > FIT_SPEED_MAX) fit.mismatch = "voice_shorter";
  return fit;
}

/** Length of the scene's video segment, or undefined when it has no video of known length. */
export function sceneSpanMs(project: Project, sceneId: string): number | undefined {
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  const media = scene?.media;
  if (!media) return undefined;
  const asset = project.assets.find((candidate) => candidate.id === media.assetId);
  if (asset?.kind !== "video") return undefined;
  const endMs = media.sourceEndMs ?? asset.durationMs;
  return endMs === undefined || endMs <= media.sourceStartMs ? undefined : endMs - media.sourceStartMs;
}

/** Manual media speed is independent of the scene's duration, voice and source trim. */
export function setMediaPlaybackRate(project: Project, sceneId: string, playbackRate: number): Project {
  const media = project.scenes.find((scene) => scene.id === sceneId)?.media;
  if (!media || project.assets.find((asset) => asset.id === media.assetId)?.kind !== "video") {
    throw new DomainError("INVALID_OPERATION", "The scene has no video media");
  }
  return updateSceneMedia(project, sceneId, { playbackRate });
}

/** The editor's fit button changes media speed only; Full AI uses fitSceneToVoice below. */
export function fitMediaToVoice(project: Project, sceneId: string): Project {
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  const spanMs = sceneSpanMs(project, sceneId);
  const voice = project.assets.find((asset) => asset.id === scene?.voiceAssetId);
  if (
    !scene ||
    spanMs === undefined ||
    voice?.kind !== "audio" ||
    !voice.durationMs ||
    voice.durationMs <= 0
  ) {
    throw new DomainError("INVALID_OPERATION", "The scene needs a video segment and voice of known length");
  }
  const fit = fitSourceSpeed(
    spanMs,
    voice.durationMs + scenePauseMs(scene.narration, project.style.scenePauseMs ?? 0),
  );
  return setMediaPlaybackRate(project, sceneId, fit.playbackRate);
}

/**
 * "Khớp tốc độ với giọng": the scene lasts its voice plus the scene pause (ADR 0018), and its video plays at
 * the speed that fills it. Without a voice the video plays at normal speed for its whole segment.
 */
export function fitSceneToVoice(project: Project, sceneId: string): { project: Project; fit: SpeedFit } {
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  const spanMs = sceneSpanMs(project, sceneId);
  if (!scene || spanMs === undefined) {
    throw new DomainError("INVALID_OPERATION", "The scene has no video segment to fit");
  }
  const voiceMs =
    scene.voiceAssetId === undefined
      ? undefined
      : project.assets.find((asset) => asset.id === scene.voiceAssetId)?.durationMs;
  const fit =
    voiceMs === undefined || voiceMs <= 0
      ? { playbackRate: 1, durationMs: spanMs }
      : fitSourceSpeed(spanMs, voiceMs + scenePauseMs(scene.narration, project.style.scenePauseMs ?? 0));
  const next = updateScene(updateSceneMedia(project, sceneId, { playbackRate: fit.playbackRate }), sceneId, {
    durationMs: fit.durationMs,
  });
  return { project: next, fit };
}
