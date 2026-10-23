import { ACCEPTED_EXTENSIONS, type Transition, type WatermarkCorner } from "@studio/domain";

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
  scenePauseMs: { min: 0, max: 1000, step: 50 },
} as const;

export const WATERMARK_CORNER_LABELS: Record<WatermarkCorner, string> = {
  "top-left": "Trên trái",
  "top-right": "Trên phải",
  "bottom-left": "Dưới trái",
  "bottom-right": "Dưới phải",
};

/** Logo sliders, in percent of the frame. */
export const WATERMARK_LIMITS = {
  sizePercent: { min: 5, max: 25, step: 1 },
  offsetPercent: { min: 0, max: 30, step: 1 },
  opacityPercent: { min: 20, max: 100, step: 5 },
  borderWidth: { min: 0, max: 12, step: 1 },
} as const;

/** Image types a logo can be: the image uploads the studio accepts. */
export const LOGO_ACCEPT = ACCEPTED_EXTENSIONS.image.map((extension) => `.${extension}`).join(",");
