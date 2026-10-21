import type { CaptionStyle } from "../project/schema";
import type { MediaFit } from "../scene/schema";
import type { DurationSource } from "../timeline/compute-timeline";

// Everything here is in frames and URLs: the composition only lays things out, it never computes timing.
// Preview (browser) and render (worker) consume the same plan, so they cannot drift apart.

export interface RenderPlanImage {
  kind: "image";
  src: string;
  fit: MediaFit;
  focusX: number;
  kenBurns: boolean;
}

export interface RenderPlanVideo {
  kind: "video";
  src: string;
  fit: MediaFit;
  focusX: number;
  volume: number;
  /** First source frame to play (Remotion `trimBefore`). */
  startFrom: number;
  /** Length of the chosen source segment. */
  segmentFrames: number;
  /** True when the segment is shorter than the sequence and must be wrapped in `<Loop>`. */
  loop: boolean;
}

export type RenderPlanMedia = RenderPlanImage | RenderPlanVideo;

export interface RenderPlanScene {
  sceneId: string;
  index: number;
  from: number;
  /** Slot on the timeline; slots are contiguous and sum to the plan duration. */
  durationInFrames: number;
  /**
   * How long the scene stays mounted: its slot plus the transition overlap into the next scene
   * (the next scene fades in on top), so transitions never shift the audio.
   */
  sequenceDurationInFrames: number;
  durationSource: DurationSource;
  media?: RenderPlanMedia;
}

export interface RenderPlanAudio {
  src: string;
  from: number;
  durationInFrames: number;
}

/** A sound effect: plays once from `from`, already cut to its own length and to the end of the video. */
export interface RenderPlanSfx {
  src: string;
  from: number;
  durationInFrames: number;
  volume: number;
}

export interface RenderPlanMusic {
  src: string;
  volume: number;
}

export interface RenderPlanCaption {
  text: string;
  from: number;
  durationInFrames: number;
}

/** The channel logo as a circle, in pixels of the frame; shown for the whole video. */
export interface RenderPlanWatermark {
  src: string;
  left: number;
  top: number;
  diameter: number;
  opacity: number;
  borderWidth: number;
  borderColor: string;
}

export interface RenderPlan {
  width: number;
  height: number;
  fps: number;
  /** 0 for a project without scenes; consumers must handle it. */
  durationInFrames: number;
  transitionFrames: number;
  background: string;
  scenes: RenderPlanScene[];
  /** The project voice or the per-scene voices, whichever track is active; never both. */
  voices: RenderPlanAudio[];
  music?: RenderPlanMusic;
  sfx: RenderPlanSfx[];
  /** Empty when captions are disabled. Text already has `uppercase` applied. */
  captions: RenderPlanCaption[];
  captionStyle: CaptionStyle;
  /** Absent when there is no logo, it is switched off, or the video has no frames. */
  watermark?: RenderPlanWatermark;
}
