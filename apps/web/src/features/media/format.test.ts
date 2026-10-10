import { describe, expect, it } from "vitest";

import { formatBytes, formatClock, formatClockTenths, formatPercent, formatResolution } from "./format";

describe("media formatting", () => {
  it("formats durations", () => {
    expect(formatClock(83_400)).toBe("1:23");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClockTenths(15_340)).toBe("0:15,3");
  });

  it("formats size, resolution and percent", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(250 * 1024 * 1024)).toBe("250 MB");
    expect(formatResolution({ width: 1920, height: 1080 })).toBe("1920×1080");
    expect(formatResolution({})).toBeNull();
    expect(formatPercent(0.456)).toBe("46%");
  });
});
