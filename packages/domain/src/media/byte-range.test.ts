import { describe, expect, it } from "vitest";

import { parseByteRange } from "./byte-range";

describe("parseByteRange", () => {
  it.each([
    [undefined, null],
    [null, null],
    ["bytes=0-3", { start: 0, end: 3 }],
    ["bytes=5-", { start: 5, end: 9 }],
    ["bytes=-4", { start: 6, end: 9 }],
    ["bytes=8-100", { start: 8, end: 9 }],
    ["bytes=-50", { start: 0, end: 9 }],
    ["bytes=10-", "invalid"],
    ["bytes=4-2", "invalid"],
    ["bytes=-0", "invalid"],
    ["bytes=-", "invalid"],
    ["items=0-1", "invalid"],
    ["bytes=0-1,4-5", "invalid"],
  ])("%s on 10 bytes → %j", (header, expected) => {
    expect(parseByteRange(header, 10)).toEqual(expected);
  });

  it("cannot satisfy any range of an empty file", () => {
    expect(parseByteRange("bytes=0-", 0)).toBe("invalid");
    expect(parseByteRange("bytes=-5", 0)).toBe("invalid");
  });
});
