import { z } from "zod";

// Clip analysis (ADR 0019): a video the user downloaded is cut into shots at its scene changes, and AI
// describes each shot, so Full AI can pick the right moment of a long clip instead of its first seconds.

/** Shorter shots are merged into a neighbour: a flash or a quick cut is not worth a scene of its own. */
export const MIN_SHOT_MS = 1200;
/** Longer shots are split, so one picture stands for at most this much video. */
export const MAX_SHOT_MS = 8000;
/** Three contact sheets of 4×4; a clip with more shots has its closest neighbours merged. */
export const MAX_SHOTS = 48;
export const SHOT_DESCRIPTION_MAX_LENGTH = 300;
export const SHOT_MAX_TAGS = 20;

export const ClipShotSchema = z
  .object({
    /** 0-based, in time order; also the number printed on the contact sheet. */
    index: z.number().int().nonnegative(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    description: z.string().max(SHOT_DESCRIPTION_MAX_LENGTH),
    /** English and Vietnamese search words, normalized like library tags. */
    tags: z.array(z.string().min(1).max(60)).max(SHOT_MAX_TAGS),
    /** Burnt-in text, subtitles or another channel's watermark: offered after clean shots. */
    textOverlay: z.boolean(),
    /** Frame from the middle of the shot, relative to the library folder. */
    thumbnailPath: z.string().min(1).optional(),
  })
  .refine((shot) => shot.endMs > shot.startMs, {
    message: "endMs must be greater than startMs",
    path: ["endMs"],
  });
export type ClipShot = z.infer<typeof ClipShotSchema>;

export const ClipAnalysisSchema = z
  .object({
    shots: z.array(ClipShotSchema).min(1).max(MAX_SHOTS),
    /** Model that wrote the descriptions, so a better model can be told apart later. */
    model: z.string().min(1),
    analyzedAt: z.iso.datetime(),
  })
  .refine(
    ({ shots }) =>
      shots.every(
        (shot, i) => shot.index === i && (i === 0 || shot.startMs >= (shots[i - 1]?.endMs ?? Infinity)),
      ),
    { message: "Shots must be numbered 0..n-1 in time order without overlapping", path: ["shots"] },
  );
export type ClipAnalysis = z.infer<typeof ClipAnalysisSchema>;

export interface ShotSpan {
  startMs: number;
  endMs: number;
}

const length = (span: ShotSpan) => span.endMs - span.startMs;

/** Joins span `i` with span `i + 1`. */
function mergeWithNext(spans: ShotSpan[], i: number): void {
  const next = spans[i + 1];
  const span = spans[i];
  if (!span || !next) return;
  spans.splice(i, 2, { startMs: span.startMs, endMs: next.endMs });
}

/**
 * Shots from the scene changes ffmpeg found: spans covering the whole clip, each at least MIN_SHOT_MS (unless
 * the clip itself is shorter) and at most MAX_SHOT_MS, no more than MAX_SHOTS. When the cap forces merging,
 * the pair of neighbours with the shortest total goes first, so the cap may leave a shot longer than
 * MAX_SHOT_MS on very long clips.
 */
export function shotsFromCuts(cutsMs: readonly number[], durationMs: number): ShotSpan[] {
  const total = Math.round(durationMs);
  if (total <= 0) return [];
  const cuts = [...new Set(cutsMs.map(Math.round))]
    .filter((cut) => cut > 0 && cut < total)
    .sort((a, b) => a - b);
  const bounds = [0, ...cuts, total];
  let spans: ShotSpan[] = bounds.slice(1).map((endMs, i) => ({ startMs: bounds[i] ?? 0, endMs }));

  // Shortest first: it joins its shorter neighbour, so a burst of quick cuts collapses into one shot.
  while (spans.length > 1) {
    const lengths = spans.map(length);
    const shortest = lengths.indexOf(Math.min(...lengths));
    if ((lengths[shortest] ?? MIN_SHOT_MS) >= MIN_SHOT_MS) break;
    const before = lengths[shortest - 1];
    const after = lengths[shortest + 1];
    const intoBefore = before !== undefined && (after === undefined || before <= after);
    mergeWithNext(spans, intoBefore ? shortest - 1 : shortest);
  }

  spans = spans.flatMap((span) => {
    const parts = Math.ceil(length(span) / MAX_SHOT_MS);
    if (parts <= 1) return [span];
    return Array.from({ length: parts }, (_, i) => ({
      startMs: span.startMs + Math.round((length(span) * i) / parts),
      endMs: span.startMs + Math.round((length(span) * (i + 1)) / parts),
    }));
  });

  while (spans.length > MAX_SHOTS) {
    const lengths = spans.map(length);
    const pair = (i: number) => (lengths[i] ?? 0) + (lengths[i + 1] ?? 0);
    let best = 0;
    for (let i = 1; i < spans.length - 1; i += 1) if (pair(i) < pair(best)) best = i;
    mergeWithNext(spans, best);
  }
  return spans;
}

/** Where the shot's picture is taken: its middle, away from the cut and any transition. */
export function shotMiddleMs(span: ShotSpan): number {
  return span.startMs + Math.floor(length(span) / 2);
}
