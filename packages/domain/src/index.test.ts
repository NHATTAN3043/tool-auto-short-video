import { describe, expect, it } from "vitest";

import * as domain from "./index";

// End-to-end through the public API: the Manual flow from script to render plan and SRT.
describe("@studio/domain public API", () => {
  it("turns a script into a render plan", () => {
    let p = domain.createProject({ name: "Demo", mode: "manual" });
    p = { ...p, scenes: domain.scriptToScenes("Cảnh một.\n\nCảnh hai, rất hay.") };
    const firstId = p.scenes[0]?.id ?? "";
    p = domain.updateScene(p, firstId, { durationMs: 2000 });

    const plan = domain.buildRenderPlan(p, (a) => a.path);
    expect(plan.scenes).toHaveLength(2);
    expect(plan.durationInFrames).toBe(132);
    expect(domain.captionsToSrt(domain.buildCaptions(p))).toContain("Cảnh hai, rất hay.");
    expect(domain.ProjectSchema.parse(p)).toEqual(p);
  });

  it("exposes DomainError with a code", () => {
    const error = new domain.DomainError("SCENE_NOT_FOUND", "x");
    expect(domain.isDomainError(error)).toBe(true);
    expect(domain.isDomainError(new Error("x"))).toBe(false);
    expect(domain.isDomainError(null)).toBe(false);
    expect(domain.isDomainError({ name: "DomainError", code: "SCENE_NOT_FOUND" })).toBe(false);
    // A copy of the class from a second module instance (as bundlers sometimes create) is still recognized.
    const foreign = Object.assign(new Error("y"), { [Symbol.for("studio.DomainError")]: true, code: "X" });
    expect(domain.isDomainError(foreign)).toBe(true);
    expect(error).toMatchObject({ name: "DomainError", code: "SCENE_NOT_FOUND", message: "x" });
  });
});
