import { describe, expect, it } from "vitest";

import { asset, project, scene } from "../testing/fixtures";
import { RECOMMENDED_MAX_DURATION_MS, reviewProject } from "./review";

const media = {
  assetId: "vid",
  sourceStartMs: 0,
  fit: "cover" as const,
  focusX: 0.5,
  volume: 0,
  kenBurns: false,
};

describe("reviewProject", () => {
  it("has nothing to say about a complete short project", () => {
    const p = project({
      assets: [asset("vid", "video")],
      scenes: [scene("a", "Một hai ba.", { media }), scene("b", "Bốn năm.", { media })],
    });
    expect(reviewProject(p)).toEqual([]);
  });

  it("reports a project without scenes", () => {
    expect(reviewProject(project())).toEqual([{ code: "NO_SCENES" }]);
  });

  it("lists every scene without media, in order", () => {
    const p = project({
      assets: [asset("vid", "video")],
      scenes: [scene("a", "Một."), scene("b", "Hai.", { media }), scene("c", "Ba.")],
    });
    expect(reviewProject(p)).toEqual([{ code: "SCENE_WITHOUT_MEDIA", sceneIds: ["a", "c"] }]);
  });

  it("warns only above 3 minutes", () => {
    const at = (ms: number) =>
      project({ assets: [asset("vid", "video")], scenes: [scene("a", "x", { media, durationMs: ms })] });
    expect(reviewProject(at(RECOMMENDED_MAX_DURATION_MS))).toEqual([]);
    expect(reviewProject(at(RECOMMENDED_MAX_DURATION_MS + 1000))).toEqual([
      { code: "VIDEO_TOO_LONG", durationMs: 181_000, limitMs: 180_000 },
    ]);
  });
});
