import { describe, expect, it } from "vitest";

import { findMissingAssetIds } from "../media/operations";
import type { MediaAsset } from "../media/schema";
import { migrateProject } from "../project/migrations";
import type { Project } from "../project/schema";
import { buildRenderPlan } from "../render-plan/build-render-plan";
import { asset, project, scene, sequentialIds } from "../testing/fixtures";
import {
  addSceneSfx,
  DEFAULT_SFX_VOLUME,
  mergeWithNext,
  removeSceneSfx,
  splitScene,
  updateSceneSfx,
} from "./operations";

const resolveUrl = (a: MediaAsset) => `/files/${a.path}`;

function twoScenes(): Project {
  return project({
    assets: [
      asset("pop", "audio", { durationMs: 1000 }),
      asset("long", "audio", { durationMs: 10_000 }),
      asset("unknown", "audio"),
      asset("img", "image"),
    ],
    scenes: [scene("a", "Một câu. Hai câu.", { durationMs: 2000 }), scene("b", "Ba.", { durationMs: 3000 })],
  });
}

describe("scene sound effects", () => {
  it("adds an effect with defaults and keeps the input untouched", () => {
    const original = twoScenes();
    const snapshot = structuredClone(original);
    const next = addSceneSfx(original, "a", { assetId: "pop" }, { newId: sequentialIds() });
    expect(next.scenes[0]?.sfx).toEqual([
      { id: "sfx_1", assetId: "pop", offsetMs: 0, volume: DEFAULT_SFX_VOLUME },
    ]);
    expect(original).toEqual(snapshot);
  });

  it("rejects non-audio assets, unknown assets and invalid values", () => {
    const p = twoScenes();
    expect(() => addSceneSfx(p, "a", { assetId: "img" })).toThrow(
      expect.objectContaining({ code: "INVALID_MEDIA" }),
    );
    expect(() => addSceneSfx(p, "a", { assetId: "gone" })).toThrow(
      expect.objectContaining({ code: "ASSET_NOT_FOUND" }),
    );
    expect(() => addSceneSfx(p, "a", { assetId: "pop", offsetMs: -1 })).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(() => addSceneSfx(p, "a", { assetId: "pop", volume: 2 })).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  it("updates and removes an effect by id", () => {
    const ctx = { newId: sequentialIds() };
    let p = addSceneSfx(twoScenes(), "a", { assetId: "pop" }, ctx);
    p = addSceneSfx(p, "a", { assetId: "long", offsetMs: 500 }, ctx);
    p = updateSceneSfx(p, "a", "sfx_1", { offsetMs: 1200, volume: 0.3 });
    expect(p.scenes[0]?.sfx?.[0]).toMatchObject({ offsetMs: 1200, volume: 0.3 });

    p = removeSceneSfx(p, "a", "sfx_1");
    expect(p.scenes[0]?.sfx?.map((effect) => effect.id)).toEqual(["sfx_2"]);
    p = removeSceneSfx(p, "a", "sfx_2");
    expect(p.scenes[0]).not.toHaveProperty("sfx");

    expect(() => removeSceneSfx(p, "a", "sfx_1")).toThrow(expect.objectContaining({ code: "SFX_NOT_FOUND" }));
    expect(() => updateSceneSfx(p, "a", "nope", { volume: 1 })).toThrow(
      expect.objectContaining({ code: "SFX_NOT_FOUND" }),
    );
  });

  it("keeps effects on the first half when splitting", () => {
    const ctx = { newId: sequentialIds() };
    const p = splitScene(addSceneSfx(twoScenes(), "a", { assetId: "pop", offsetMs: 300 }, ctx), "a", ctx);
    expect(p.scenes[0]?.sfx).toHaveLength(1);
    expect(p.scenes[1]).not.toHaveProperty("sfx");
  });

  it("merges effects and shifts the second scene's by the first manual duration", () => {
    const ctx = { newId: sequentialIds() };
    let p = addSceneSfx(twoScenes(), "a", { assetId: "pop", offsetMs: 100 }, ctx);
    p = addSceneSfx(p, "b", { assetId: "long", offsetMs: 500 }, ctx);
    const merged = mergeWithNext(p, "a").scenes[0];
    expect(merged?.sfx?.map((effect) => effect.offsetMs)).toEqual([100, 2500]);
  });

  it("reports missing sound effect assets", () => {
    const p = project({
      scenes: [scene("a", "x", { sfx: [{ id: "sfx_1", assetId: "gone", offsetMs: 0, volume: 1 }] })],
    });
    expect(findMissingAssetIds(p)).toEqual(["gone"]);
  });

  it("still reads v1 projects written before sound effects existed", () => {
    const stored = JSON.parse(JSON.stringify(twoScenes())) as unknown;
    expect(migrateProject(stored).scenes[0]).not.toHaveProperty("sfx");
  });
});

describe("buildRenderPlan sound effects", () => {
  it("places effects from their scene start, cut to their length and to the end of the video", () => {
    const ctx = { newId: sequentialIds() };
    let p = addSceneSfx(twoScenes(), "a", { assetId: "pop", offsetMs: 500, volume: 0.5 }, ctx);
    p = addSceneSfx(p, "b", { assetId: "long", offsetMs: 1000 }, ctx);
    p = addSceneSfx(p, "b", { assetId: "unknown", offsetMs: 2000 }, ctx);
    p = addSceneSfx(p, "b", { assetId: "pop", offsetMs: 9000 }, ctx);

    const plan = buildRenderPlan(p, resolveUrl);
    expect(plan.durationInFrames).toBe(150);
    expect(plan.sfx).toEqual([
      { src: "/files/media/pop.bin", from: 15, durationInFrames: 30, volume: 0.5 },
      { src: "/files/media/long.bin", from: 90, durationInFrames: 60, volume: DEFAULT_SFX_VOLUME },
      { src: "/files/media/unknown.bin", from: 120, durationInFrames: 30, volume: DEFAULT_SFX_VOLUME },
    ]);
  });

  it("is empty when no scene has effects", () => {
    expect(buildRenderPlan(twoScenes(), resolveUrl).sfx).toEqual([]);
  });
});
