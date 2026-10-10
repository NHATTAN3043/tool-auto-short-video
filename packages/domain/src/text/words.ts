/** Closing quotes/brackets that belong to the sentence or clause before them. */
export const CLOSERS = `"'”’»)\\]`;

const SENTENCE_END_RUN = /[.!?…]+/gu;
const PAUSE_MARK = /[,;:]/gu;

export const WORDS_PER_SECOND = 2.6;
export const MIN_ESTIMATE_MS = 1200;

/** Vietnamese writes one syllable per space-separated token, so tokens approximate spoken length well. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

export function speechWeight(text: string): number {
  const sentenceEnds = text.match(SENTENCE_END_RUN)?.length ?? 0;
  const pauses = text.match(PAUSE_MARK)?.length ?? 0;
  return Math.max(1, countWords(text) + 1.5 * sentenceEnds + 0.7 * pauses);
}

export function estimateSpeechMs(text: string): number {
  return Math.max(MIN_ESTIMATE_MS, Math.round((speechWeight(text) / WORDS_PER_SECOND) * 1000));
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * Splits `total` into integer parts proportional to `weights` whose sum is exactly `total`.
 * Rounding cumulative boundaries (not each part) keeps rounding error from accumulating.
 */
export function distributeByWeight(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0) return weights.map(() => 0);
  const parts: number[] = [];
  let cumulative = 0;
  let previousBoundary = 0;
  for (const weight of weights) {
    cumulative += weight;
    const boundary = Math.round((total * cumulative) / weightSum);
    parts.push(boundary - previousBoundary);
    previousBoundary = boundary;
  }
  return parts;
}
