import { describe, expect, it } from "vitest";

import { normalizeTags, stockSourceRef, type LibraryMedia } from "./media-library";
import {
  foldText,
  MediaSearchQuerySchema,
  pickPreviewRendition,
  pickRendition,
  rankCandidates,
  scoreLibraryItem,
  searchLibrary,
  type MediaCandidate,
} from "./search";

const item = (id: string, tags: string[], extra: Partial<LibraryMedia> = {}): LibraryMedia => ({
  id,
  kind: "video",
  fileName: `${id}.mp4`,
  path: `files/${id}.mp4`,
  tags,
  usageCount: 0,
  source: "pexels",
  sourceRef: `pexels:video:${id}`,
  contentHash: "sha256:x",
  createdAt: "2026-10-01T00:00:00.000Z",
  ...extra,
});

const candidate = (
  provider: MediaCandidate["provider"],
  ref: string,
  width: number,
  height: number,
  extra: Partial<MediaCandidate> = {},
): MediaCandidate => ({
  provider,
  ref,
  kind: "video",
  width,
  height,
  thumbnail: { type: "remote", url: `https://images.example/${ref}.jpg` },
  ...extra,
});

describe("media library helpers", () => {
  it("normalizes tags and builds source refs", () => {
    expect(normalizeTags([" Mèo  Con ", "mèo con", "", "小猫"])).toEqual(["mèo con", "小猫"]);
    expect(stockSourceRef("pixabay", "image", "42")).toBe("pixabay:image:42");
  });

  it("folds Vietnamese accents", () => {
    expect(foldText("Mèo Đen")).toBe("meo den");
  });
});

describe("scoreLibraryItem / searchLibrary", () => {
  it("matches whole tags, words without accents and Chinese substrings", () => {
    const cat = item("a", ["mèo con", "cat playing", "小猫玩耍"]);
    expect(scoreLibraryItem(cat, "Mèo con")).toBe(100);
    expect(scoreLibraryItem(cat, "meo")).toBeGreaterThan(0);
    expect(scoreLibraryItem(cat, "cat sleeping")).toBeGreaterThan(0);
    expect(scoreLibraryItem(cat, "小猫")).toBeGreaterThan(0);
    expect(scoreLibraryItem(cat, "dog")).toBe(0);
    expect(scoreLibraryItem(cat, "  ")).toBe(0);
  });

  it("keeps the right kind and sorts by score, then portrait, then usage", () => {
    const items = [
      item("land", ["cat"], { width: 1920, height: 1080, usageCount: 9 }),
      item("port", ["cat"], { width: 1080, height: 1920 }),
      item("exact-ish", ["cat", "cat on sofa"], { width: 1920, height: 1080 }),
      item("image", ["cat"], { kind: "image" }),
      item("other", ["dog"]),
    ];
    expect(searchLibrary(items, "cat on sofa", "video").map((i) => i.id)).toEqual([
      "exact-ish",
      "port",
      "land",
    ]);
    expect(searchLibrary(items, "cat", "image").map((i) => i.id)).toEqual(["image"]);
  });
});

describe("rankCandidates", () => {
  it("puts the library first, then alternates providers with portrait clips first", () => {
    const library = [candidate("library", "lib_1", 1080, 1920)];
    const pexels = [candidate("pexels", "p1", 1920, 1080), candidate("pexels", "p2", 1080, 1920)];
    const pixabay = [
      candidate("pixabay", "x1", 1080, 1920),
      candidate("pixabay", "x-dup", 1080, 1920, { libraryId: "lib_1" }),
    ];
    expect(rankCandidates(library, [pexels, pixabay]).map((c) => c.ref)).toEqual(["lib_1", "p2", "x1", "p1"]);
  });
});

describe("pickRendition", () => {
  const files = [
    { width: 3840, height: 2160, url: "4k" },
    { width: 1920, height: 1080, url: "1080" },
    { width: 1280, height: 720, url: "720" },
    { width: 640, height: 360, url: "360" },
  ];

  it("picks the smallest file reaching 1080, never 4K when 1080 exists", () => {
    expect(pickRendition(files)?.url).toBe("1080");
    expect(pickRendition(files.slice(0, 1))?.url).toBe("4k");
    expect(pickRendition(files.slice(2))?.url).toBe("720");
    expect(pickRendition(files.slice(0, 0))).toBeUndefined();
  });

  it("previews with the smallest file", () => {
    expect(pickPreviewRendition(files)?.url).toBe("360");
  });
});

describe("MediaSearchQuerySchema", () => {
  it("defaults to English and every source", () => {
    expect(MediaSearchQuerySchema.parse({ query: " mèo ", kind: "video" })).toEqual({
      query: "mèo",
      kind: "video",
      lang: "en",
      sources: ["library", "pexels", "pixabay"],
    });
    expect(MediaSearchQuerySchema.safeParse({ query: "", kind: "video" }).success).toBe(false);
  });
});
