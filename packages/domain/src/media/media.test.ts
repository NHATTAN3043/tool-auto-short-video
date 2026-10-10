import { describe, expect, it } from "vitest";

import { asset, project, scene } from "../testing/fixtures";
import { contentTypeForFileName, fileExtension, mediaKindFromFileName } from "./accepted-files";
import { addAsset, findMissingAssetIds } from "./operations";

describe("accepted files", () => {
  it.each([
    ["clip.MP4", "video"],
    ["phone.mov", "video"],
    ["a.webm", "video"],
    ["photo.JPEG", "image"],
    ["x.jpg", "image"],
    ["x.png", "image"],
    ["x.webp", "image"],
    ["voice.mp3", "audio"],
    ["voice.wav", "audio"],
    ["voice.m4a", "audio"],
  ])("%s is %s", (name, kind) => {
    expect(mediaKindFromFileName(name)).toBe(kind);
  });

  it.each(["virus.exe", "noext", "archive.mp4.zip", "x.", ""])("rejects %j", (name) => {
    expect(mediaKindFromFileName(name)).toBeNull();
  });

  it("maps file names to the content type they are served with", () => {
    expect(contentTypeForFileName("a.MP4")).toBe("video/mp4");
    expect(contentTypeForFileName("x.jpeg")).toBe("image/jpeg");
    expect(contentTypeForFileName("v.m4a")).toBe("audio/mp4");
    expect(contentTypeForFileName("strange.bin")).toBe("application/octet-stream");
    expect(contentTypeForFileName("noext")).toBe("application/octet-stream");
  });

  it("extracts the lower-case extension", () => {
    expect(fileExtension(" Video.Final.MOV ")).toBe("mov");
    expect(fileExtension("README")).toBeNull();
  });
});

describe("addAsset", () => {
  it("appends a validated asset without mutating the project", () => {
    const original = project();
    const next = addAsset(original, asset("ast_1", "video"));
    expect(next.assets.map((a) => a.id)).toEqual(["ast_1"]);
    expect(original.assets).toEqual([]);
  });

  it("rejects duplicates and invalid assets", () => {
    const p = addAsset(project(), asset("ast_1", "video"));
    expect(() => addAsset(p, asset("ast_1", "image"))).toThrow(
      expect.objectContaining({ code: "INVALID_OPERATION" }),
    );
    expect(() => addAsset(p, asset("ast_2", "video", { durationMs: -5 }))).toThrow(
      expect.objectContaining({ code: "INVALID_MEDIA" }),
    );
  });
});

describe("findMissingAssetIds", () => {
  it("lists every dangling reference once", () => {
    const cover = { sourceStartMs: 0, fit: "cover" as const, focusX: 0.5, volume: 0, kenBurns: false };
    const p = project({
      assets: [asset("ok", "video")],
      voiceAssetId: "gone-voice",
      music: { assetId: "gone-music", volume: 0.1 },
      scenes: [
        scene("a", "x", { media: { ...cover, assetId: "ok" } }),
        scene("b", "y", { media: { ...cover, assetId: "gone-media" }, voiceAssetId: "gone-voice" }),
      ],
    });
    expect(findMissingAssetIds(p)).toEqual(["gone-voice", "gone-music", "gone-media"]);
    expect(findMissingAssetIds(project())).toEqual([]);
  });
});
