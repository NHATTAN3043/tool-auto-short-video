import type { Transition } from "@studio/domain";

export const TRANSITION_LABELS: Record<Transition, string> = {
  none: "Không có",
  fade: "Mờ dần (fade)",
};

/** Slider ranges: wide enough for real use, narrow enough that a slip of the mouse stays watchable. */
export const STYLE_LIMITS = {
  fontSize: { min: 32, max: 120, step: 2 },
  positionPercent: { min: 10, max: 90, step: 1 },
  wordsPerCaption: { min: 1, max: 12, step: 1 },
  transitionMs: { min: 100, max: 1000, step: 50 },
} as const;
