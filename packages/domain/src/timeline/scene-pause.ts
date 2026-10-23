import { CLOSERS } from "../text/words";

const ENDS_SENTENCE = new RegExp(`[.!?…][${CLOSERS}]*$`, "u");

/** A scene that stops mid-sentence (comma, no mark) keeps the thought going, so it breathes for less. */
const MID_SENTENCE_RATIO = 2 / 3;

/**
 * Silence after a scene voice (ADR 0018). Voices made with request stitching run straight into each other,
 * so the timeline adds the breath the narrator would take: the full pause after a sentence, two thirds of it
 * when the narration carries on into the next scene.
 */
export function scenePauseMs(narration: string, baseMs: number): number {
  if (baseMs <= 0) return 0;
  return ENDS_SENTENCE.test(narration.trim()) ? baseMs : Math.round(baseMs * MID_SENTENCE_RATIO);
}
