import { createProject, type MediaAsset, type Project, type Scene, type SceneMedia } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { isSceneReady, sceneReadiness } from "./readiness";

const NOW = "2026-01-01T00:00:00.000Z";

const media: SceneMedia = {
  assetId: "vid",
  sourceStartMs: 0,
  fit: "cover",
  focusX: 0.5,
  volume: 0,
  kenBurns: false,
};

const asset = (id: string, kind: MediaAsset["kind"], source: MediaAsset["source"]): MediaAsset => ({
  id,
  kind,
  source,
  fileName: `${id}.bin`,
  path: `media/${id}.bin`,
  createdAt: NOW,
});

const scene = (narration: string, extra: Partial<Scene> = {}): Scene => ({
  id: "s1",
  narration,
  status: "draft",
  ...extra,
});

function project(scenes: Scene[]): Project {
  return {
    ...createProject({ name: "Test", mode: "manual" }, { newId: () => "prj_1", now: NOW }),
    scenes,
    assets: [asset("vid", "video", "upload"), asset("voice", "audio", "upload")],
  };
}

describe("sceneReadiness", () => {
  it("lists the missing narration and media", () => {
    const empty = scene("");
    expect(sceneReadiness(project([empty]), empty, false)).toEqual({
      missing: "Thiếu lời, media",
      voiceOutdated: false,
    });
  });

  it("asks for a scene voice only when per-scene voices are expected", () => {
    const noVoice = scene("Một hai ba.", { media });
    const p = project([noVoice]);
    expect(sceneReadiness(p, noVoice, false).missing).toBeNull();
    expect(sceneReadiness(p, noVoice, true).missing).toBe("Thiếu giọng");
  });

  it("is ready with narration, media and a voice", () => {
    const done = scene("Một hai ba.", { media, voiceAssetId: "voice" });
    const readiness = sceneReadiness(project([done]), done, true);
    expect(readiness).toEqual({ missing: null, voiceOutdated: false });
    expect(isSceneReady(readiness)).toBe(true);
  });
});
