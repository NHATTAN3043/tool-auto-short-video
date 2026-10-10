import { describe, expect, it } from "vitest";

import { DomainError } from "../errors";
import { sequentialIds } from "../testing/fixtures";
import { groupSentences, scriptToScenes, splitScriptBlocks } from "./script-to-scenes";
import { splitNearMiddle, splitSentences } from "./split-text";

const narrations = (script: string, options?: Parameters<typeof scriptToScenes>[1]) =>
  scriptToScenes(script, options, { newId: sequentialIds() }).map((s) => s.narration);

describe("splitScriptBlocks", () => {
  it("splits on blank lines, --- and scene markers, dropping the marker", () => {
    const script = [
      "[Cảnh 1]",
      "Mở đầu thật",
      "hấp dẫn.",
      "",
      "",
      "Đoạn hai.",
      "---",
      "[Scene 3: outro] Kết thúc.",
      "[CẢNH 4]",
      "Thêm nữa.",
    ].join("\r\n");
    expect(splitScriptBlocks(script)).toEqual([
      "Mở đầu thật hấp dẫn.",
      "Đoạn hai.",
      "Kết thúc.",
      "Thêm nữa.",
    ]);
  });

  it("returns nothing for an empty script", () => {
    expect(splitScriptBlocks("")).toEqual([]);
    expect(splitScriptBlocks("\n  \n---\n[Cảnh 1]\n")).toEqual([]);
  });
});

describe("splitSentences", () => {
  it("keeps punctuation and closing quotes with the sentence", () => {
    expect(splitSentences('Bạn biết không?! Thật "bất ngờ." (Đúng vậy…) Hết')).toEqual([
      "Bạn biết không?!",
      'Thật "bất ngờ."',
      "(Đúng vậy…)",
      "Hết",
    ]);
  });

  it("does not split decimals", () => {
    expect(splitSentences("Giá là 3.5 triệu. Rẻ")).toEqual(["Giá là 3.5 triệu.", "Rẻ"]);
  });
});

describe("groupSentences", () => {
  it("groups consecutive sentences within the word limit", () => {
    expect(groupSentences("Một hai. Ba bốn. Năm sáu bảy.", 4)).toEqual(["Một hai. Ba bốn.", "Năm sáu bảy."]);
  });

  it("keeps an over-long sentence on its own", () => {
    expect(groupSentences("A. B c d e f g. H.", 3)).toEqual(["A.", "B c d e f g.", "H."]);
  });
});

describe("scriptToScenes", () => {
  it("returns no scenes for an empty script", () => {
    expect(scriptToScenes("   \n\n ")).toEqual([]);
  });

  it("creates draft scenes with prefixed ids", () => {
    const scenes = scriptToScenes("Một.\n\nHai.", {}, { newId: sequentialIds() });
    expect(scenes).toEqual([
      { id: "scn_1", narration: "Một.", status: "draft" },
      { id: "scn_2", narration: "Hai.", status: "draft" },
    ]);
    expect(scriptToScenes("Một.")[0]?.id).toMatch(/^scn_/u);
  });

  it("auto uses paragraphs when there are several blocks", () => {
    expect(narrations("Câu một. Câu hai.\n\nCâu ba.", { maxWordsPerScene: 2 })).toEqual([
      "Câu một. Câu hai.",
      "Câu ba.",
    ]);
  });

  it("auto groups sentences when there is a single block", () => {
    const script = "Hôm nay trời đẹp. Chúng ta đi chơi nhé. Bạn có muốn không? Đi thôi!";
    expect(narrations(script, { maxWordsPerScene: 8 })).toEqual([
      "Hôm nay trời đẹp.",
      "Chúng ta đi chơi nhé.",
      "Bạn có muốn không? Đi thôi!",
    ]);
  });

  it("uses 18 words per scene by default", () => {
    const sentence = "Một hai ba bốn năm sáu.";
    expect(narrations(Array.from({ length: 4 }, () => sentence).join(" "))).toHaveLength(2);
  });

  it("sentence strategy splits inside each paragraph", () => {
    expect(narrations("A b. C d.\n\nE f.", { strategy: "sentence", maxWordsPerScene: 2 })).toEqual([
      "A b.",
      "C d.",
      "E f.",
    ]);
  });

  it("paragraph strategy ignores the word limit", () => {
    expect(narrations("A b. C d. E f.", { strategy: "paragraph", maxWordsPerScene: 2 })).toEqual([
      "A b. C d. E f.",
    ]);
  });

  it.each([0, -1, 2.5])("rejects maxWordsPerScene %s", (maxWordsPerScene) => {
    expect(() => scriptToScenes("A.", { maxWordsPerScene })).toThrow(DomainError);
  });
});

describe("splitNearMiddle", () => {
  it("prefers the clause boundary nearest the middle", () => {
    expect(splitNearMiddle("Một hai ba. Bốn năm, sáu bảy tám chín mười.")).toEqual([
      "Một hai ba. Bốn năm,",
      "sáu bảy tám chín mười.",
    ]);
  });

  it("falls back to the space nearest the middle", () => {
    expect(splitNearMiddle("một hai ba bốn")).toEqual(["một hai", "ba bốn"]);
  });

  it("returns null for a single word or empty text", () => {
    expect(splitNearMiddle("  một. ")).toBeNull();
    expect(splitNearMiddle("")).toBeNull();
  });
});
