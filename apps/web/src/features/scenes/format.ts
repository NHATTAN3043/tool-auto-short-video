import { countWords, estimateSpeechMs, scriptToScenes, type ScriptSplitStrategy } from "@studio/domain";

// Conversions between domain milliseconds and what the user reads or types (Vietnamese decimal comma).

/** `7800` → `0:07,8`. Tenths are enough to line scenes up with a voice track by ear. */
export function formatMs(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${String(minutes)}:${String(seconds).padStart(2, "0")},${String(tenths % 10)}`;
}

/** `3500` → `3,5`; used as the text of the manual duration field. */
export function formatSecondsInput(ms: number | undefined): string {
  if (ms === undefined) return "";
  return String(Math.round(ms / 100) / 10).replace(".", ",");
}

export type ParsedDuration = { ok: true; durationMs: number | null } | { ok: false; error: string };

export const MAX_SCENE_SECONDS = 600;

/** Empty = automatic (null). Accepts `3`, `3.5` or `3,5` seconds. */
export function parseDurationInput(text: string): ParsedDuration {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, durationMs: null };
  if (!/^\d+(?:[.,]\d+)?$/u.test(trimmed)) return { ok: false, error: "Nhập số giây, ví dụ 3,5." };
  const durationMs = Math.round(Number(trimmed.replace(",", ".")) * 1000);
  if (durationMs <= 0) return { ok: false, error: "Thời lượng phải lớn hơn 0." };
  if (durationMs > MAX_SCENE_SECONDS * 1000) {
    return { ok: false, error: `Tối đa ${String(MAX_SCENE_SECONDS)} giây mỗi cảnh.` };
  }
  return { ok: true, durationMs };
}

export const MAX_WORDS_PER_SCENE_LIMIT = 100;

/** Returns the parsed limit, or null when the field does not hold a whole number in range. */
export function parseMaxWords(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_WORDS_PER_SCENE_LIMIT ? value : null;
}

export interface SplitPreview {
  sceneCount: number;
  /** Sum of the per-scene speech estimates, the same numbers the timeline will start from. */
  estimatedMs: number;
  /** Scenes longer than the word limit; only possible when whole paragraphs become scenes. */
  overLimitCount: number;
}

/** What "Tách cảnh" would produce right now, so the user sees the result before replacing scenes. */
export function previewSplit(script: string, strategy: ScriptSplitStrategy, maxWords: number): SplitPreview {
  const scenes = scriptToScenes(script, { strategy, maxWordsPerScene: maxWords }, { newId: () => "preview" });
  return {
    sceneCount: scenes.length,
    estimatedMs: scenes.reduce((sum, scene) => sum + estimateSpeechMs(scene.narration), 0),
    overLimitCount: scenes.filter((scene) => countWords(scene.narration) > maxWords).length,
  };
}
