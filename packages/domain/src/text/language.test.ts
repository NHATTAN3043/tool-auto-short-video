import { describe, expect, it } from "vitest";

import { normalizeSceneRewrite, normalizeScriptSuggestion } from "../ai/normalize";
import { looksVietnamese, matchesLanguage, vietnameseRatio } from "./language";

describe("looksVietnamese", () => {
  it("accepts Vietnamese narration, with English names or keywords in it", () => {
    expect(looksVietnamese("Bạn có biết mèo ngủ tới mười sáu tiếng mỗi ngày không?")).toBe(true);
    expect(looksVietnamese("Mẹo dùng iPhone và MacBook mà ít người biết, xem hết nhé.")).toBe(true);
    // Decomposed marks (NFD) as some keyboards and copies produce them.
    expect(looksVietnamese("Bạn có biết mèo ngủ rất nhiều mỗi ngày".normalize("NFD"))).toBe(true);
  });

  it("rejects English prose", () => {
    expect(looksVietnamese("Did you know that cats sleep for most of the day?")).toBe(false);
    expect(looksVietnamese("Stop scrolling. This one trick will change how you cook forever.")).toBe(false);
  });

  it("does not judge texts too short to tell", () => {
    expect(vietnameseRatio("OK, let's go!")).toBeNull();
    expect(looksVietnamese("Follow for more")).toBe(true);
  });
});

describe("AI output language", () => {
  it("drops an English script or rewrite", () => {
    expect(() =>
      normalizeScriptSuggestion({ title: "Cats", script: "Did you know that cats sleep all day long?" }),
    ).toThrow(/không phải tiếng Việt/u);
    expect(() =>
      normalizeSceneRewrite({ narration: "Here is the thing nobody tells you about cats." }),
    ).toThrow(/không phải tiếng Việt/u);
    expect(
      normalizeScriptSuggestion({ title: "Mèo", script: "Mèo ngủ rất nhiều.\n\nVì sao vậy?" }).script,
    ).toBe("Mèo ngủ rất nhiều.\n\nVì sao vậy?");
  });

  it("drops a Vietnamese script or rewrite in an English project, keeps English", () => {
    expect(() =>
      normalizeScriptSuggestion({ title: "Mèo", script: "Bạn có biết mèo ngủ cả ngày không?" }, "en"),
    ).toThrow(/không phải tiếng Anh/u);
    expect(() =>
      normalizeSceneRewrite({ narration: "Đây là điều không ai nói cho bạn về mèo." }, "en"),
    ).toThrow(/không phải tiếng Anh/u);
    expect(
      normalizeSceneRewrite({ narration: "Here is the thing nobody tells you about cats." }, "en").narration,
    ).toBe("Here is the thing nobody tells you about cats.");
  });
});

describe("matchesLanguage", () => {
  it("tells Vietnamese and English apart, and does not judge short texts", () => {
    const vi = "Bạn có biết mèo ngủ tới mười sáu tiếng mỗi ngày không?";
    const en = "Did you know that cats sleep for most of the day?";
    expect([matchesLanguage(vi, "vi"), matchesLanguage(vi, "en")]).toEqual([true, false]);
    expect([matchesLanguage(en, "vi"), matchesLanguage(en, "en")]).toEqual([false, true]);
    expect([matchesLanguage("Xin chào!", "en"), matchesLanguage("OK!", "vi")]).toEqual([true, true]);
  });
});
