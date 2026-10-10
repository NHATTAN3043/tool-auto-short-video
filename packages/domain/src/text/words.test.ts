import { describe, expect, it } from "vitest";

import { countWords, distributeByWeight, estimateSpeechMs, normalizeWhitespace, speechWeight } from "./words";

describe("words", () => {
  it("counts space-separated Vietnamese syllables", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords(" Hôm nay  trời\nđẹp ")).toBe(4);
  });

  it("weights sentence ends and pauses", () => {
    // 4 words + 1.5 × 1 sentence end ("...") + 0.7 × 1 comma
    expect(speechWeight("Một, hai ba bốn...")).toBeCloseTo(6.2);
    expect(speechWeight("")).toBe(1);
  });

  it("estimates at ~2.6 words per second with a 1.2s floor", () => {
    expect(estimateSpeechMs("Chào")).toBe(1200);
    const twentySix = Array.from({ length: 26 }, () => "từ").join(" ");
    expect(estimateSpeechMs(twentySix)).toBe(10_000);
  });

  it("normalizes whitespace", () => {
    expect(normalizeWhitespace("  a \n\t b ")).toBe("a b");
  });

  it("distributes a total exactly by weight", () => {
    expect(distributeByWeight(10, [1, 1, 1])).toEqual([3, 4, 3]);
    expect(distributeByWeight(1000, [1, 3])).toEqual([250, 750]);
    expect(distributeByWeight(7, [])).toEqual([]);
    expect(distributeByWeight(7, [0, 0])).toEqual([0, 0]);
    const parts = distributeByWeight(9999, [1.3, 2.7, 0.5, 4]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(9999);
  });
});
