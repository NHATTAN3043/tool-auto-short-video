import { CLOSERS, normalizeWhitespace } from "../text/words";

/** Whitespace that follows sentence-ending punctuation (plus any closing quotes/brackets). */
const SENTENCE_BREAK = new RegExp(`(?<=[.!?…]+[${CLOSERS}]*)\\s+`, "u");
/** End of a sentence or clause followed by whitespace: a natural place to cut narration. */
const CLAUSE_END = new RegExp(`[.!?…,;:]+[${CLOSERS}]*(?=\\s)`, "gu");

export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_BREAK)
    .map(normalizeWhitespace)
    .filter((sentence) => sentence !== "");
}

/**
 * Splits text into two non-empty halves at the clause boundary nearest the middle,
 * or at the whitespace nearest the middle when there is no punctuation. Null when it cannot be split.
 */
export function splitNearMiddle(text: string): [string, string] | null {
  const normalized = normalizeWhitespace(text);
  const middle = normalized.length / 2;

  const pick = (cuts: number[]): [string, string] | null => {
    let best: number | null = null;
    for (const cut of cuts) {
      if (cut <= 0 || cut >= normalized.length) continue;
      if (best === null || Math.abs(cut - middle) < Math.abs(best - middle)) best = cut;
    }
    if (best === null) return null;
    const head = normalized.slice(0, best).trim();
    const tail = normalized.slice(best).trim();
    return head !== "" && tail !== "" ? [head, tail] : null;
  };

  const clauseCuts = [...normalized.matchAll(CLAUSE_END)].map((match) => match.index + match[0].length);
  const spaceCuts = [...normalized.matchAll(/ /gu)].map((match) => match.index);
  return pick(clauseCuts) ?? pick(spaceCuts);
}
