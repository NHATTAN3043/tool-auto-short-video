// Pure styling math shared by the layers, kept free of React so it can be unit tested.

export const CAPTION_FONT_FAMILY = "Be Vietnam Pro";
export const KEN_BURNS_MAX_SCALE = 1.08;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Opacity of a scene that fades in over the previous one. The previous scene stays fully visible
 * underneath, so total duration and audio sync are unaffected by the transition.
 */
export function fadeInOpacity(frame: number, transitionFrames: number, isFirstScene: boolean): number {
  if (isFirstScene || transitionFrames <= 0) return 1;
  return clamp01(frame / transitionFrames);
}

/** Slow zoom 1 → 1.08 across the whole scene. */
export function kenBurnsScale(frame: number, durationInFrames: number): number {
  if (durationInFrames <= 1) return 1;
  return 1 + (KEN_BURNS_MAX_SCALE - 1) * clamp01(frame / (durationInFrames - 1));
}

/**
 * Text outline as 16 hard shadows around the glyphs. `-webkit-text-stroke` renders inconsistently
 * across Chrome versions and eats into thin Vietnamese diacritics; shadows look the same everywhere.
 */
export function outlineShadow(widthPx: number, color = "#000"): string {
  return Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * 2 * Math.PI;
    const x = (Math.cos(angle) * widthPx).toFixed(2);
    const y = (Math.sin(angle) * widthPx).toFixed(2);
    return `${x}px ${y}px 0 ${color}`;
  }).join(", ");
}

const PLACEHOLDER_GRADIENTS = [
  ["#1e293b", "#0f172a"],
  ["#312e81", "#1e1b4b"],
  ["#134e4a", "#042f2e"],
  ["#4c1d95", "#2e1065"],
  ["#7c2d12", "#431407"],
] as const;

/** Dark gradient for scenes without media, varying by position so the preview is still readable. */
export function placeholderGradient(sceneIndex: number): string {
  const [from, to] =
    PLACEHOLDER_GRADIENTS[sceneIndex % PLACEHOLDER_GRADIENTS.length] ?? PLACEHOLDER_GRADIENTS[0];
  return `linear-gradient(160deg, ${from} 0%, ${to} 100%)`;
}

/** CSS object-position that crops a landscape source to 9:16 around `focusX`. */
export function focusPosition(focusX: number): string {
  return `${String(Math.round(clamp01(focusX) * 1000) / 10)}% 50%`;
}
