import { describe, expect, it } from "vitest";

import { formatPlaybackRate, parsePlaybackRate } from "./playback-rate";

describe("manual speed input", () => {
  it.each([
    ["0,5", 0.5],
    ["2", 2],
    ["1.25", 1.25],
    [" 1,27 ", 1.27],
    ["1.183", 1.18],
  ])("accepts %s as %s", (text, expected) => {
    expect(parsePlaybackRate(text)).toBe(expected);
  });
  it.each(["", " ", "0", "-1", "0.49", "2.01", "NaN", "Infinity", "1,2.3", "1abc", "1e0"])(
    "rejects %s",
    (text) => {
      expect(parsePlaybackRate(text)).toBeNull();
    },
  );
  it("keeps fitted speed precision for display", () => {
    expect(formatPlaybackRate(1.183)).toBe("1,183");
    expect(formatPlaybackRate(1)).toBe("1");
  });
});
