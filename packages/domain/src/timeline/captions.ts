import type { Project } from "../project/schema";
import { CLOSERS, distributeByWeight, speechWeight } from "../text/words";
import { computeTimeline, type TimelineEntry } from "./compute-timeline";

export interface Caption {
  sceneId: string;
  /** 0-based position across the whole video. */
  index: number;
  text: string;
  startMs: number;
  endMs: number;
}

const ENDS_SENTENCE = new RegExp(`[.!?…][${CLOSERS}]*$`, "u");
const ENDS_CLAUSE = new RegExp(`[,;:][${CLOSERS}]*$`, "u");
/** A comma only ends a caption once the caption is this full, so captions are not too short. */
const COMMA_BREAK_RATIO = 0.6;

/** Cuts narration into on-screen captions of at most `maxWords` words (one more when absorbing an orphan). */
export function chunkNarration(text: string, maxWords: number): string[] {
  const words = text
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== "");
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const word of words) {
    current.push(word);
    const full = current.length >= maxWords;
    const sentenceEnd = ENDS_SENTENCE.test(word);
    const clauseEnd = ENDS_CLAUSE.test(word) && current.length >= COMMA_BREAK_RATIO * maxWords;
    if (full || sentenceEnd || clauseEnd) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current);

  // A single trailing word alone on screen looks broken, so it joins the previous caption.
  const last = chunks.at(-1);
  const previous = chunks.at(-2);
  if (last?.length === 1 && previous) {
    previous.push(...last);
    chunks.pop();
  }
  return chunks.map((chunk) => chunk.join(" "));
}

/** Captions timed within each scene by speech weight; the last caption of a scene ends exactly with it. */
export function buildCaptions(
  project: Project,
  timeline: readonly TimelineEntry[] = computeTimeline(project),
): Caption[] {
  const maxWords = project.style.captions.maxWordsPerCaption;
  const captions: Caption[] = [];
  project.scenes.forEach((scene, sceneIndex) => {
    const entry = timeline[sceneIndex];
    if (!entry) return;
    const chunks = chunkNarration(scene.narration, maxWords);
    const durations = distributeByWeight(entry.durationMs, chunks.map(speechWeight));
    let startMs = entry.startMs;
    chunks.forEach((text, i) => {
      const endMs = startMs + (durations[i] ?? 0);
      if (endMs > startMs) captions.push({ sceneId: scene.id, index: captions.length, text, startMs, endMs });
      startMs = endMs;
    });
  });
  return captions;
}

function srtTime(ms: number): string {
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(ms % 1000, 3)}`;
}

export function captionsToSrt(captions: readonly Caption[]): string {
  return captions
    .map(
      (caption, i) =>
        `${String(i + 1)}\n${srtTime(caption.startMs)} --> ${srtTime(caption.endMs)}\n${caption.text}\n`,
    )
    .join("\n");
}
