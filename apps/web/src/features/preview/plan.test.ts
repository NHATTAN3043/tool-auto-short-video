import { createProject, scriptToScenes, type Project, type SceneMedia } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { previewPlan, sceneStartFrame } from "./plan";

const media: SceneMedia = {
  assetId: "ast_1",
  sourceStartMs: 0,
  fit: "cover",
  focusX: 0.5,
  volume: 0,
  kenBurns: false,
};

function project(extra: Partial<Project> = {}): Project {
  let n = 0;
  const scenes = scriptToScenes(
    "Một hai ba bốn.\n\nNăm sáu bảy tám.",
    {},
    { newId: () => `scn_${String(++n)}` },
  );
  return { ...createProject({ name: "P", mode: "manual" }, { newId: () => "prj_1" }), scenes, ...extra };
}

describe("preview plan", () => {
  it("serves media through the file route of the project", () => {
    const base = project();
    const p: Project = {
      ...base,
      assets: [
        {
          id: "ast_1",
          kind: "video",
          source: "upload",
          fileName: "a b.mp4",
          path: "media/ast_1.mp4",
          durationMs: 10_000,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      scenes: base.scenes.map((scene, index) => (index === 0 ? { ...scene, media } : scene)),
    };
    const result = previewPlan(p);
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.scenes[0]?.media?.src).toBe("/api/projects/prj_1/files/media/ast_1.mp4");
  });

  it("reports a broken asset reference instead of throwing", () => {
    const result = previewPlan(project({ voiceAssetId: "ast_gone" }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining("không còn tồn tại") as string });
  });

  it("finds where each scene starts", () => {
    const result = previewPlan(project());
    if (!result.ok) throw new Error(result.error);
    expect(sceneStartFrame(result.plan, "scn_1")).toBe(0);
    expect(sceneStartFrame(result.plan, "scn_2")).toBe(result.plan.scenes[1]?.from);
    expect(sceneStartFrame(result.plan, "scn_2")).toBeGreaterThan(0);
    expect(sceneStartFrame(result.plan, "nope")).toBeNull();
  });
});
