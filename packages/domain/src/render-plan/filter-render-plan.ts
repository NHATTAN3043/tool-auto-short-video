import type { RenderPlan } from "./types";

/** Parts of a plan that can be rendered on their own, e.g. separate tracks for an editor like CapCut. */
export interface RenderLayers {
  /** Scene images/videos, including the original sound of video clips. */
  visuals: boolean;
  captions: boolean;
  voices: boolean;
  music: boolean;
  sfx: boolean;
}

export const ALL_LAYERS: Readonly<RenderLayers> = {
  visuals: true,
  captions: true,
  voices: true,
  music: true,
  sfx: true,
};

/**
 * Drops the layers that are switched off and keeps all timing, so every partial render lines up with
 * the full video from frame 0. Same plan, same composition: no second composition is ever needed.
 */
export function filterRenderPlan(plan: RenderPlan, layers: RenderLayers): RenderPlan {
  const next: RenderPlan = {
    ...plan,
    scenes: layers.visuals
      ? plan.scenes
      : plan.scenes.map((scene) => {
          const withoutMedia = { ...scene };
          delete withoutMedia.media;
          return withoutMedia;
        }),
    captions: layers.captions ? plan.captions : [],
    voices: layers.voices ? plan.voices : [],
    sfx: layers.sfx ? plan.sfx : [],
  };
  if (!layers.music) delete next.music;
  return next;
}

/** True when the layers would render nothing audible, so an audio-only track can be skipped. */
export function hasAudibleAudio(plan: RenderPlan): boolean {
  const clipAudio = plan.scenes.some((scene) => scene.media?.kind === "video" && scene.media.volume > 0);
  return clipAudio || plan.voices.length > 0 || plan.sfx.length > 0 || (plan.music?.volume ?? 0) > 0;
}
