import { buildRenderPlan, isDomainError, type Project, type RenderPlan } from "@studio/domain";

import { projectFileUrl } from "@/features/media/api";

export type PreviewPlan = { ok: true; plan: RenderPlan } | { ok: false; error: string };

/**
 * The same plan the worker renders, with URLs of this app's file route. A broken asset reference is
 * reported instead of crashing the editor.
 */
export function previewPlan(project: Project): PreviewPlan {
  try {
    return { ok: true, plan: buildRenderPlan(project, (asset) => projectFileUrl(project.id, asset.path)) };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { ok: false, error: "Không dựng được bản xem trước: có cảnh dùng file media không còn tồn tại." };
  }
}

/** First frame of a scene in the preview, or null when the scene is not in the plan. */
export function sceneStartFrame(plan: RenderPlan, sceneId: string): number | null {
  return plan.scenes.find((scene) => scene.sceneId === sceneId)?.from ?? null;
}

/**
 * First frame where the scene is fully visible, for "Xem cảnh này". With a fade transition a scene starts at
 * opacity 0 over the previous one, so its very first frame shows the previous scene (or black while that
 * video is still loading). Never past the scene's own slot.
 */
export function sceneViewFrame(plan: RenderPlan, sceneId: string): number | null {
  const scene = plan.scenes.find((candidate) => candidate.sceneId === sceneId);
  if (!scene) return null;
  if (scene.index === 0) return scene.from;
  return scene.from + Math.min(plan.transitionFrames, Math.max(0, scene.durationInFrames - 1));
}
