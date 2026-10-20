import type { ContentLanguage } from "../text/language";

// Free keyword suggestions for a scene that has none from AI: short phrases of content words taken from
// its narration, in the project language. Weaker than AI keywords (no English for a Vietnamese video), but
// they need no key and cost nothing, so every mode has something to search with.

/** Phrases offered per scene. */
export const NARRATION_KEYWORDS_MAX = 4;
/** Words per phrase: a Vietnamese word is often two syllables, so three keeps one or two real words. */
const PHRASE_MAX_WORDS = 3;

const STOPWORDS: Record<ContentLanguage, ReadonlySet<string>> = {
  vi: new Set(
    [
      "à ạ ai anh ấy bạn bao biết bị bởi các cái cả cần chỉ cho chứ chúng chưa có còn của cũng cùng đã đang đây đấy để",
      "đều điều đó được gì hay hãy hết hơn khi không là lại lên làm lúc mà mình mỗi một này nên nếu người nhé nhiều",
      "nhưng những nào nữa ở ra rằng rất rồi sao sau sẽ so tại theo thế thì tôi trên trong từ vào vẫn về vì với vừa",
      "và xem đi nha ơi luôn thật quá hơi lắm chính mới đến tới cứ ta họ em chị nó bọn",
    ]
      .join(" ")
      .split(" "),
  ),
  en: new Set(
    [
      "a about after all also an and any are as at be because been but by can could did do does for from get got",
      "had has have he her here him his how i if in into is it its just like make me more most my no not now of on",
      "one only or our out over so some than that the their them then there these they this those to too up us very",
      "was we were what when where which who why will with would you your yours let lets thing things really",
    ]
      .join(" ")
      .split(" "),
  ),
};

const CLAUSE = /[.,!?;:…\n()"“”'‘’«»—–-]+/u;
const WORD = /\p{L}[\p{L}\p{N}]*/gu;

/**
 * Up to NARRATION_KEYWORDS_MAX search phrases from the narration: runs of content words between stop words
 * and punctuation, cut into phrases of at most PHRASE_MAX_WORDS, longest first, in reading order among equals.
 */
export function narrationKeywords(narration: string, language: ContentLanguage): string[] {
  const stopwords = STOPWORDS[language];
  const runs: { phrase: string; words: number; order: number }[] = [];
  for (const clause of narration.normalize("NFC").toLocaleLowerCase(language).split(CLAUSE)) {
    let run: string[] = [];
    const flush = () => {
      for (let start = 0; start < run.length; start += PHRASE_MAX_WORDS) {
        const words = run.slice(start, start + PHRASE_MAX_WORDS);
        runs.push({ phrase: words.join(" "), words: words.length, order: runs.length });
      }
      run = [];
    };
    for (const word of clause.match(WORD) ?? []) {
      if (stopwords.has(word) || word.length < 2) flush();
      else run.push(word);
    }
    flush();
  }
  const seen = new Set<string>();
  return runs
    .sort((a, b) => b.words - a.words || a.order - b.order)
    .filter((run) => {
      if (seen.has(run.phrase)) return false;
      seen.add(run.phrase);
      return true;
    })
    .slice(0, NARRATION_KEYWORDS_MAX)
    .map((run) => run.phrase);
}
