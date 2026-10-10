import { describe, expect, it } from "vitest";

import {
  fadeInOpacity,
  focusPosition,
  KEN_BURNS_MAX_SCALE,
  kenBurnsScale,
  outlineShadow,
  placeholderGradient,
} from "./style";

describe("style helpers", () => {
  it("fades a scene in over the transition, except the first one", () => {
    expect(fadeInOpacity(0, 8, false)).toBe(0);
    expect(fadeInOpacity(4, 8, false)).toBe(0.5);
    expect(fadeInOpacity(8, 8, false)).toBe(1);
    expect(fadeInOpacity(50, 8, false)).toBe(1);
    expect(fadeInOpacity(0, 8, true)).toBe(1);
    expect(fadeInOpacity(0, 0, false)).toBe(1);
  });

  it("zooms from 1 to 1.08 over the scene", () => {
    expect(kenBurnsScale(0, 100)).toBe(1);
    expect(kenBurnsScale(99, 100)).toBeCloseTo(KEN_BURNS_MAX_SCALE);
    expect(kenBurnsScale(500, 100)).toBeCloseTo(KEN_BURNS_MAX_SCALE);
    expect(kenBurnsScale(0, 1)).toBe(1);
  });

  it("outlines text with 16 shadows", () => {
    const shadow = outlineShadow(4);
    expect(shadow.split(", ")).toHaveLength(16);
    expect(shadow.startsWith("4.00px 0.00px 0 #000")).toBe(true);
  });

  it("cycles placeholder gradients by scene index", () => {
    expect(placeholderGradient(0)).toMatch(/^linear-gradient/u);
    expect(placeholderGradient(5)).toBe(placeholderGradient(0));
    expect(placeholderGradient(1)).not.toBe(placeholderGradient(0));
  });

  it("maps focusX to a horizontal object-position", () => {
    expect(focusPosition(0.5)).toBe("50% 50%");
    expect(focusPosition(0.123)).toBe("12.3% 50%");
    expect(focusPosition(2)).toBe("100% 50%");
  });
});
