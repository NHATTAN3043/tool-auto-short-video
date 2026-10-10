import type { Project } from "../project/schema";
import { activeVoiceTrack } from "../voice/voice-status";
import { distributeByWeight, estimateSpeechMs, speechWeight } from "../text/words";

/** Where a scene's duration came from; shown in the UI so the user knows which scenes are guesses. */
export type DurationSource = "manual" | "scene-voice" | "project-voice" | "estimate";

export interface TimelineEntry {
  sceneId: string;
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  source: DurationSource;
}

interface FixedDuration {
  durationMs: number;
  source: "manual" | "scene-voice";
}

/**
 * Durations, by priority: manual → the scene's own voice → share of the project voice left over after
 * fixed scenes (by speech weight) → estimate from word count. Only the active voice track counts: scene
 * voices are ignored while the project voice plays, and the other way round.
 */
export function computeTimeline(project: Project): TimelineEntry[] {
  const track = activeVoiceTrack(project);
  const durationOf = new Map(project.assets.map((asset) => [asset.id, asset.durationMs]));
  const positive = (ms: number | undefined): number | undefined =>
    ms !== undefined && ms > 0 ? ms : undefined;

  const fixed = project.scenes.map((scene): FixedDuration | null => {
    if (scene.durationMs !== undefined) return { durationMs: scene.durationMs, source: "manual" };
    const voiceMs =
      track !== "scenes" || scene.voiceAssetId === undefined
        ? undefined
        : positive(durationOf.get(scene.voiceAssetId));
    return voiceMs === undefined ? null : { durationMs: voiceMs, source: "scene-voice" };
  });

  const autoScenes = project.scenes.filter((_, i) => fixed[i] === null);
  const fixedTotal = fixed.reduce((sum, entry) => sum + (entry?.durationMs ?? 0), 0);
  const projectVoiceMs =
    track !== "project" || project.voiceAssetId === undefined
      ? undefined
      : positive(durationOf.get(project.voiceAssetId));
  const remainingMs = projectVoiceMs === undefined ? 0 : projectVoiceMs - fixedTotal;

  // When fixed scenes already exceed the voice there is nothing left to share, so auto scenes fall back
  // to estimates instead of collapsing to zero.
  const useProjectVoice = autoScenes.length > 0 && remainingMs >= autoScenes.length;
  const shares = useProjectVoice
    ? distributeByWeight(
        remainingMs,
        autoScenes.map((scene) => speechWeight(scene.narration)),
      )
    : [];

  const entries: TimelineEntry[] = [];
  let startMs = 0;
  let autoIndex = 0;
  project.scenes.forEach((scene, index) => {
    const fixedEntry = fixed[index];
    let durationMs: number;
    let source: DurationSource;
    if (fixedEntry) {
      ({ durationMs, source } = fixedEntry);
    } else if (useProjectVoice) {
      durationMs = Math.max(1, shares[autoIndex] ?? 0);
      source = "project-voice";
      autoIndex += 1;
    } else {
      durationMs = estimateSpeechMs(scene.narration);
      source = "estimate";
    }
    entries.push({ sceneId: scene.id, index, startMs, endMs: startMs + durationMs, durationMs, source });
    startMs += durationMs;
  });
  return entries;
}

export function timelineDurationMs(timeline: readonly TimelineEntry[]): number {
  return timeline.at(-1)?.endMs ?? 0;
}
