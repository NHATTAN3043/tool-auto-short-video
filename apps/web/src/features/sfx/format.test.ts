import { describe, expect, it } from "vitest";

import { formatOffsetInput, formatSfxLength, parseOffsetInput } from "./format";

describe("sound effect offsets", () => {
  it("formats milliseconds as seconds with a decimal comma", () => {
    expect(formatOffsetInput(0)).toBe("0");
    expect(formatOffsetInput(1500)).toBe("1,5");
    expect(formatSfxLength(800)).toBe("0,8 giây");
    expect(formatSfxLength(undefined)).toBe("");
  });

  it("parses seconds, treating an empty field as the scene start", () => {
    expect(parseOffsetInput(" ")).toEqual({ ok: true, offsetMs: 0 });
    expect(parseOffsetInput("0")).toEqual({ ok: true, offsetMs: 0 });
    expect(parseOffsetInput("1,5")).toEqual({ ok: true, offsetMs: 1500 });
    expect(parseOffsetInput("2.25")).toEqual({ ok: true, offsetMs: 2250 });
  });

  it("rejects text, negative and oversized values", () => {
    for (const text of ["abc", "-1", "1s", "601"]) expect(parseOffsetInput(text).ok, text).toBe(false);
  });
});
