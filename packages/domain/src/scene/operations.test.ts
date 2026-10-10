import { describe, expect, it } from "vitest";

import type { Project } from "../project/schema";
import { asset, project, scene, sequentialIds } from "../testing/fixtures";
import {
  assignMedia,
  clearMedia,
  deleteScene,
  insertSceneAfter,
  mergeWithNext,
  moveScene,
  splitScene,
  updateScene,
  updateSceneMedia,
} from "./operations";
import type { SceneMedia } from "./schema";

const media: SceneMedia = {
  assetId: "vid",
  sourceStartMs: 0,
  fit: "cover",
  focusX: 0.5,
  volume: 0,
  kenBurns: false,
};

function threeScenes(): Project {
  return project({
    scenes: [scene("a", "Một."), scene("b", "Hai."), scene("c", "Ba.")],
    assets: [
      asset("vid", "video", { durationMs: 20_000 }),
      asset("img", "image"),
      asset("mp3", "audio", { durationMs: 5000 }),
      asset("vid-unknown", "video"),
    ],
  });
}

const ids = (p: Project) => p.scenes.map((s) => s.id);
const ctx = { newId: sequentialIds() };

describe("scene operations", () => {
  it("never mutate the input project", () => {
    const original = threeScenes();
    const snapshot = structuredClone(original);
    insertSceneAfter(original, "a", {}, ctx);
    deleteScene(original, "a");
    moveScene(original, "a", 2);
    updateScene(original, "a", { narration: "x", durationMs: 1000 });
    splitScene(updateScene(original, "a", { narration: "Một hai. Ba bốn." }), "a", ctx);
    mergeWithNext(original, "a");
    assignMedia(original, "a", { assetId: "vid" });
    clearMedia(original, "a");
    expect(original).toEqual(snapshot);
  });

  it.each([
    ["insertSceneAfter", (p: Project) => insertSceneAfter(p, "zzz")],
    ["deleteScene", (p: Project) => deleteScene(p, "zzz")],
    ["moveScene", (p: Project) => moveScene(p, "zzz", 0)],
    ["updateScene", (p: Project) => updateScene(p, "zzz", {})],
    ["splitScene", (p: Project) => splitScene(p, "zzz")],
    ["mergeWithNext", (p: Project) => mergeWithNext(p, "zzz")],
    ["assignMedia", (p: Project) => assignMedia(p, "zzz", { assetId: "vid" })],
    ["clearMedia", (p: Project) => clearMedia(p, "zzz")],
  ])("%s throws SCENE_NOT_FOUND for an unknown scene", (_name, operation) => {
    expect(() => operation(threeScenes())).toThrow(expect.objectContaining({ code: "SCENE_NOT_FOUND" }));
  });

  describe("insertSceneAfter", () => {
    it("inserts after the given scene or at the start", () => {
      const p = threeScenes();
      expect(ids(insertSceneAfter(p, "b", {}, { newId: () => "new" }))).toEqual(["a", "b", "new", "c"]);
      expect(ids(insertSceneAfter(p, null, {}, { newId: () => "new" }))).toEqual(["new", "a", "b", "c"]);
      expect(ids(insertSceneAfter(project(), null, {}, { newId: () => "new" }))).toEqual(["new"]);
    });

    it("creates an empty draft or uses the init values", () => {
      const plan = { intent: "x", preferredMedia: "video" as const, searchQueries: ["q"] };
      const p = insertSceneAfter(
        project(),
        null,
        { narration: "Lời", durationMs: 2000, visualPlan: plan },
        { newId: () => "n" },
      );
      expect(p.scenes[0]).toEqual({
        id: "n",
        narration: "Lời",
        status: "draft",
        durationMs: 2000,
        visualPlan: plan,
      });
      expect(insertSceneAfter(project(), null).scenes[0]).toMatchObject({ narration: "", status: "draft" });
      expect(() => insertSceneAfter(project(), null, { durationMs: 0 })).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });
  });

  describe("deleteScene", () => {
    it("removes the scene, including the last remaining one", () => {
      expect(ids(deleteScene(threeScenes(), "b"))).toEqual(["a", "c"]);
      expect(deleteScene(project({ scenes: [scene("only", "x")] }), "only").scenes).toEqual([]);
    });
  });

  describe("moveScene", () => {
    it("moves a scene and clamps the target index", () => {
      const p = threeScenes();
      expect(ids(moveScene(p, "a", 2))).toEqual(["b", "c", "a"]);
      expect(ids(moveScene(p, "c", 0))).toEqual(["c", "a", "b"]);
      expect(ids(moveScene(p, "b", 99))).toEqual(["a", "c", "b"]);
      expect(ids(moveScene(p, "b", -5))).toEqual(["b", "a", "c"]);
      expect(moveScene(p, "b", 1)).toBe(p);
    });
  });

  describe("updateScene", () => {
    it("updates fields and clears them with null", () => {
      const plan = { intent: "x", preferredMedia: "image" as const, searchQueries: [] };
      let p = updateScene(threeScenes(), "a", {
        narration: "Mới",
        durationMs: 3000,
        voiceAssetId: "mp3",
        visualPlan: plan,
        status: "approved",
      });
      expect(p.scenes[0]).toEqual({
        id: "a",
        narration: "Mới",
        durationMs: 3000,
        voiceAssetId: "mp3",
        visualPlan: plan,
        status: "approved",
      });
      p = updateScene(p, "a", { durationMs: null, voiceAssetId: null, visualPlan: null });
      expect(p.scenes[0]).toEqual({ id: "a", narration: "Mới", status: "approved" });
    });

    it("leaves status alone when narration changes", () => {
      const p = updateScene(threeScenes(), "a", { status: "ready" });
      expect(updateScene(p, "a", { narration: "x" }).scenes[0]?.status).toBe("ready");
    });

    it("validates duration and voice asset", () => {
      const p = threeScenes();
      expect(() => updateScene(p, "a", { durationMs: -1 })).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(() => updateScene(p, "a", { durationMs: 1.5 })).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(() => updateScene(p, "a", { voiceAssetId: "nope" })).toThrow(
        expect.objectContaining({ code: "ASSET_NOT_FOUND" }),
      );
      expect(() => updateScene(p, "a", { voiceAssetId: "vid" })).toThrow(
        expect.objectContaining({ code: "INVALID_MEDIA" }),
      );
    });
  });

  describe("splitScene", () => {
    it("splits at the sentence boundary nearest the middle", () => {
      const p = updateScene(threeScenes(), "b", { narration: "Câu một ngắn. Câu hai dài hơn một chút. Ba." });
      const result = splitScene(p, "b", { newId: () => "b2" });
      expect(ids(result)).toEqual(["a", "b", "b2", "c"]);
      expect(result.scenes[1]?.narration).toBe("Câu một ngắn.");
      expect(result.scenes[2]).toEqual({
        id: "b2",
        narration: "Câu hai dài hơn một chút. Ba.",
        status: "draft",
      });
    });

    it("keeps media and visual plan on the first half and drops the stale scene voice", () => {
      let p = updateScene(threeScenes(), "a", {
        narration: "Một hai ba bốn",
        voiceAssetId: "mp3",
        status: "approved",
      });
      p = assignMedia(p, "a", { assetId: "vid" });
      const [first, second] = splitScene(p, "a", { newId: () => "a2" }).scenes;
      expect(first).toMatchObject({
        id: "a",
        narration: "Một hai",
        status: "approved",
        media: { assetId: "vid" },
      });
      expect(first?.voiceAssetId).toBeUndefined();
      expect(second).toEqual({ id: "a2", narration: "ba bốn", status: "draft" });
    });

    it("shares a manual duration by text length", () => {
      const p = updateScene(threeScenes(), "a", { narration: "aaaa, bbbbbbbbbbbb", durationMs: 1000 });
      const [first, second] = splitScene(p, "a", ctx).scenes;
      expect(first?.durationMs).toBe(294);
      expect(second?.durationMs).toBe(706);
    });

    it("refuses to split a single word", () => {
      expect(() => splitScene(threeScenes(), "a")).toThrow(
        expect.objectContaining({ code: "INVALID_OPERATION" }),
      );
    });
  });

  describe("mergeWithNext", () => {
    it("joins narration and keeps the first scene's id and media", () => {
      let p = assignMedia(threeScenes(), "a", { assetId: "vid" });
      p = assignMedia(p, "b", { assetId: "img" });
      const result = mergeWithNext(p, "a");
      expect(ids(result)).toEqual(["a", "c"]);
      expect(result.scenes[0]).toMatchObject({ id: "a", narration: "Một. Hai.", media: { assetId: "vid" } });
    });

    it("falls back to the next scene's media and visual plan", () => {
      const plan = { intent: "x", preferredMedia: "image" as const, searchQueries: [] };
      let p = assignMedia(threeScenes(), "b", { assetId: "img" });
      p = updateScene(p, "b", { visualPlan: plan });
      expect(mergeWithNext(p, "a").scenes[0]).toMatchObject({ media: { assetId: "img" }, visualPlan: plan });
    });

    it("sums manual durations only when both scenes have one and drops scene voices", () => {
      let p = updateScene(threeScenes(), "a", { durationMs: 1000, voiceAssetId: "mp3" });
      expect(mergeWithNext(p, "a").scenes[0]?.durationMs).toBeUndefined();
      expect(mergeWithNext(p, "a").scenes[0]?.voiceAssetId).toBeUndefined();
      p = updateScene(p, "b", { durationMs: 500 });
      expect(mergeWithNext(p, "a").scenes[0]?.durationMs).toBe(1500);
    });

    it("refuses to merge the last scene", () => {
      expect(() => mergeWithNext(threeScenes(), "c")).toThrow(
        expect.objectContaining({ code: "INVALID_OPERATION" }),
      );
    });
  });

  describe("assignMedia / clearMedia", () => {
    it("fills defaults for a video: muted, cover, centered", () => {
      const p = assignMedia(threeScenes(), "a", { assetId: "vid", sourceStartMs: 3200, sourceEndMs: 9500 });
      expect(p.scenes[0]?.media).toEqual({ ...media, sourceStartMs: 3200, sourceEndMs: 9500 });
    });

    it("keeps explicit settings", () => {
      const input = { assetId: "vid", fit: "contain" as const, focusX: 0.2, volume: 0.4, kenBurns: true };
      expect(assignMedia(threeScenes(), "a", input).scenes[0]?.media).toEqual({ ...input, sourceStartMs: 0 });
    });

    it("uses Ken Burns and ignores trimming for images", () => {
      const p = assignMedia(threeScenes(), "a", {
        assetId: "img",
        sourceStartMs: 500,
        sourceEndMs: 900,
        volume: 1,
      });
      expect(p.scenes[0]?.media).toEqual({ ...media, assetId: "img", kenBurns: true });
    });

    it("clamps an end past the video and rejects a start past it", () => {
      const p = threeScenes();
      expect(assignMedia(p, "a", { assetId: "vid", sourceEndMs: 25_000 }).scenes[0]?.media?.sourceEndMs).toBe(
        20_000,
      );
      expect(() => assignMedia(p, "a", { assetId: "vid", sourceStartMs: 20_000 })).toThrow(
        expect.objectContaining({ code: "INVALID_MEDIA" }),
      );
      expect(
        assignMedia(p, "a", { assetId: "vid-unknown", sourceStartMs: 50_000 }).scenes[0]?.media
          ?.sourceStartMs,
      ).toBe(50_000);
    });

    it("rejects audio, unknown assets and invalid ranges", () => {
      const p = threeScenes();
      expect(() => assignMedia(p, "a", { assetId: "mp3" })).toThrow(
        expect.objectContaining({ code: "INVALID_MEDIA" }),
      );
      expect(() => assignMedia(p, "a", { assetId: "nope" })).toThrow(
        expect.objectContaining({ code: "ASSET_NOT_FOUND" }),
      );
      expect(() => assignMedia(p, "a", { assetId: "vid", sourceStartMs: 5000, sourceEndMs: 4000 })).toThrow(
        expect.objectContaining({ code: "INVALID_MEDIA" }),
      );
      expect(() => assignMedia(p, "a", { assetId: "vid", focusX: 2 })).toThrow(
        expect.objectContaining({ code: "INVALID_MEDIA" }),
      );
    });

    it("changing media never touches narration or voice", () => {
      const p = updateScene(threeScenes(), "a", { voiceAssetId: "mp3", durationMs: 1234 });
      const changed = clearMedia(assignMedia(p, "a", { assetId: "vid" }), "a");
      expect(changed.scenes[0]).toEqual(p.scenes[0]);
    });

    it("updateSceneMedia changes one setting and keeps the rest", () => {
      const p = assignMedia(threeScenes(), "a", { assetId: "vid", sourceStartMs: 1000, sourceEndMs: 4000 });
      const moved = updateSceneMedia(p, "a", { sourceStartMs: 15_000, sourceEndMs: 22_000 });
      expect(moved.scenes[0]?.media).toEqual({ ...media, sourceStartMs: 15_000, sourceEndMs: 20_000 });
      const framed = updateSceneMedia(p, "a", { fit: "contain", focusX: 0.1, volume: 0.3 });
      expect(framed.scenes[0]?.media).toMatchObject({
        sourceEndMs: 4000,
        fit: "contain",
        focusX: 0.1,
        volume: 0.3,
      });
      expect(updateSceneMedia(p, "a", { sourceEndMs: null }).scenes[0]?.media).not.toHaveProperty(
        "sourceEndMs",
      );
      expect(p.scenes[0]?.media?.sourceStartMs).toBe(1000);
    });

    it("updateSceneMedia rejects a scene without media and invalid values", () => {
      expect(() => updateSceneMedia(threeScenes(), "a", { fit: "contain" })).toThrow(
        expect.objectContaining({ code: "INVALID_OPERATION" }),
      );
      const p = assignMedia(threeScenes(), "a", { assetId: "vid", sourceStartMs: 5000 });
      expect(() => updateSceneMedia(p, "a", { sourceEndMs: 4000 })).toThrow(
        expect.objectContaining({ code: "INVALID_MEDIA" }),
      );
    });
  });
});
