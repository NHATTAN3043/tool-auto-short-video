import { describe, expect, it } from "vitest";

import { NARRATION_KEYWORDS_MAX, narrationKeywords } from "./narration-keywords";

describe("narrationKeywords", () => {
  it("keeps runs of content words between stop words and punctuation, longest first", () => {
    expect(narrationKeywords("Bạn có biết mèo con ngủ tới mười sáu tiếng mỗi ngày không?", "vi")).toEqual([
      "mèo con ngủ",
      "mười sáu tiếng",
      "ngày",
    ]);
  });

  it("works in English and drops duplicates", () => {
    expect(narrationKeywords("Cats sleep all day. Cats sleep a lot, and the kitten plays.", "en")).toEqual([
      "cats sleep",
      "kitten plays",
      "day",
      "lot",
    ]);
  });

  it("returns at most a few phrases, and none for empty or stop-word-only text", () => {
    const long = "Mèo đen, chó vàng, gà trống, vịt bầu, heo con, bò sữa, dê núi.";
    expect(narrationKeywords(long, "vi")).toHaveLength(NARRATION_KEYWORDS_MAX);
    expect(narrationKeywords("", "vi")).toEqual([]);
    expect(narrationKeywords("Và là của những cái đó.", "vi")).toEqual([]);
  });
});
