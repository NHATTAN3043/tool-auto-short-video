import { describe, expect, it } from "vitest";

import { formatMs, formatSecondsInput, parseDurationInput, parseMaxWords, previewSplit } from "./format";

describe("formatMs", () => {
  it("shows minutes, seconds and tenths", () => {
    expect(formatMs(0)).toBe("0:00,0");
    expect(formatMs(7800)).toBe("0:07,8");
    expect(formatMs(65_430)).toBe("1:05,4");
  });

  it("carries rounding into the next second and minute", () => {
    expect(formatMs(9960)).toBe("0:10,0");
    expect(formatMs(59_960)).toBe("1:00,0");
    expect(formatMs(-5)).toBe("0:00,0");
  });
});

describe("formatSecondsInput", () => {
  it("renders the manual duration with a decimal comma", () => {
    expect(formatSecondsInput(undefined)).toBe("");
    expect(formatSecondsInput(3000)).toBe("3");
    expect(formatSecondsInput(3500)).toBe("3,5");
  });
});

describe("parseDurationInput", () => {
  it("treats an empty field as automatic", () => {
    expect(parseDurationInput("  ")).toEqual({ ok: true, durationMs: null });
  });

  it("accepts whole and decimal seconds with comma or dot", () => {
    expect(parseDurationInput("3")).toEqual({ ok: true, durationMs: 3000 });
    expect(parseDurationInput("3,5")).toEqual({ ok: true, durationMs: 3500 });
    expect(parseDurationInput(" 2.25 ")).toEqual({ ok: true, durationMs: 2250 });
  });

  it("rejects zero, negative, oversized and non-numeric input", () => {
    for (const text of ["0", "0,0", "-1", "abc", "3s", "1,2,3", "601"]) {
      expect(parseDurationInput(text).ok, text).toBe(false);
    }
  });
});

describe("parseMaxWords", () => {
  it("accepts whole numbers from 1 to 100", () => {
    expect(parseMaxWords("18")).toBe(18);
    expect(parseMaxWords("1")).toBe(1);
    expect(parseMaxWords("100")).toBe(100);
  });

  it("rejects anything else", () => {
    for (const text of ["", "0", "101", "4.5", "-3", "x"]) expect(parseMaxWords(text), text).toBeNull();
  });
});

describe("previewSplit", () => {
  it("counts the scenes each strategy would create", () => {
    const script = "Câu một. Câu hai.\n\n[Cảnh 2] Câu ba.";
    expect(previewSplit(script, "auto", 18).sceneCount).toBe(2);
    expect(previewSplit("Một hai ba. Bốn năm sáu.", "sentence", 3).sceneCount).toBe(2);
    expect(previewSplit("", "auto", 18)).toEqual({ sceneCount: 0, estimatedMs: 0, overLimitCount: 0 });
  });

  it("flags paragraph scenes that are longer than the word limit", () => {
    const preview = previewSplit("một hai ba bốn năm\n---\nsáu", "paragraph", 3);
    expect(preview.sceneCount).toBe(2);
    expect(preview.overLimitCount).toBe(1);
    expect(preview.estimatedMs).toBeGreaterThan(0);
  });
});
