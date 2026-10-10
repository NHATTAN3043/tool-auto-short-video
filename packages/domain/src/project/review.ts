import { computeTimeline, timelineDurationMs } from "../timeline/compute-timeline";
import type { Project } from "./schema";

/** Longest video the studio aims for: YouTube Shorts allow up to 3 minutes. */
export const RECOMMENDED_MAX_DURATION_MS = 180_000;

export type ProjectWarning =
  | { code: "NO_SCENES" }
  | { code: "SCENE_WITHOUT_MEDIA"; sceneIds: string[] }
  | { code: "VIDEO_TOO_LONG"; durationMs: number; limitMs: number };

/**
 * Problems worth showing before a render. None of them blocks rendering: a scene without media renders
 * on a dark gradient so the preview stays watchable.
 */
export function reviewProject(project: Project): ProjectWarning[] {
  if (project.scenes.length === 0) return [{ code: "NO_SCENES" }];
  const warnings: ProjectWarning[] = [];
  const withoutMedia = project.scenes.filter((scene) => !scene.media).map((scene) => scene.id);
  if (withoutMedia.length > 0) warnings.push({ code: "SCENE_WITHOUT_MEDIA", sceneIds: withoutMedia });
  const durationMs = timelineDurationMs(computeTimeline(project));
  if (durationMs > RECOMMENDED_MAX_DURATION_MS) {
    warnings.push({ code: "VIDEO_TOO_LONG", durationMs, limitMs: RECOMMENDED_MAX_DURATION_MS });
  }
  return warnings;
}
