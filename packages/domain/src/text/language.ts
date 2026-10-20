import { z } from "zod";

// A project speaks one language (ADR 0013): the AI writes its narration in it and the TTS is told to read
// it. AI output is checked before it reaches the project, because English notes (skills, ADR 0012) can pull
// the model into writing English, and Vietnamese ideas into writing Vietnamese.

/** ISO 639-1, as ElevenLabs takes it. */
export const ContentLanguageSchema = z.enum(["vi", "en"]);
export type ContentLanguage = z.infer<typeof ContentLanguageSchema>;
export const DEFAULT_CONTENT_LANGUAGE: ContentLanguage = "vi";

export const CONTENT_LANGUAGE_LABELS: Record<ContentLanguage, string> = {
  vi: "Tiếng Việt",
  en: "Tiếng Anh",
};

/** Letters only Vietnamese uses among Latin scripts: tone marks, â ê ô ơ ư ă and đ. */
const VIETNAMESE_LETTER = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/u;
const WORD = /\p{L}+/gu;

/** Below this many words a text says too little to judge (a name, "OK", a number). */
export const LANGUAGE_CHECK_MIN_WORDS = 6;
/** Vietnamese prose marks well over half its syllables; English with a few Vietnamese names stays far below. */
export const VIETNAMESE_MIN_MARKED_RATIO = 0.3;

/** Share of the words (syllables) that carry a Vietnamese letter, 0..1; null when too short to judge. */
export function vietnameseRatio(text: string): number | null {
  const words = text.normalize("NFC").toLocaleLowerCase("vi").match(WORD) ?? [];
  if (words.length < LANGUAGE_CHECK_MIN_WORDS) return null;
  const marked = words.filter((word) => VIETNAMESE_LETTER.test(word)).length;
  return marked / words.length;
}

/** True unless the text is long enough to judge and clearly not Vietnamese. */
export function looksVietnamese(text: string): boolean {
  const ratio = vietnameseRatio(text);
  return ratio === null || ratio >= VIETNAMESE_MIN_MARKED_RATIO;
}

/**
 * True unless the text is long enough to judge and clearly in another language. English is told apart
 * only from Vietnamese, the other language the studio speaks.
 */
export function matchesLanguage(text: string, language: ContentLanguage): boolean {
  if (language === "vi") return looksVietnamese(text);
  const ratio = vietnameseRatio(text);
  return ratio === null || ratio < VIETNAMESE_MIN_MARKED_RATIO;
}
