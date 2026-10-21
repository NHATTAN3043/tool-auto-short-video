import { describe, expect, it } from "vitest";

import { normalizeTags, stockSourceRef, type LibraryMedia } from "./media-library";
import type { MediaAsset } from "./schema";
import {
  capOwnCandidates,
  foldText,
  isOwnCandidate,
  MediaSearchQuerySchema,
  MIN_MATCH_SCORE,
  pickPreviewRendition,
  pickRendition,
  rankCandidates,
  scoreLibraryItem,
  scoreTags,
  searchLibrary,
  searchProjectAssets,
  tagsFromFileName,
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

  it("ignores stop words and drops matches below the minimum score", () => {
    const beach = item("beach", ["cat sleeping in the sun"]);
    expect(scoreTags(beach.tags, "woman walking in the city")).toBe(0);
    // One shared word is a hint, not a match.
    expect(scoreTags(["cat playing"], "cat sleeping")).toBeLessThan(MIN_MATCH_SCORE);
    expect(searchLibrary([item("p", ["cat playing"])], "cat sleeping", "video")).toEqual([]);
    expect(scoreTags(["orange cat", "sofa"], "orange cat on sofa")).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
  });
});

describe("tagsFromFileName / searchProjectAssets", () => {
  const asset = (id: string, fileName: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
    id,
    kind: "video",
    source: "upload",
    fileName,
    path: `media/${id}.mp4`,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  });

  it("reads tags from the file name: __ between tags, - _ . between words", () => {
    expect(tagsFromFileName("cat-sleeping__Orange_Cat__sofa.mp4")).toEqual([
      "cat sleeping",
      "orange cat",
      "sofa",
    ]);
    expect(tagsFromFileName("mèo-ngủ.trên-ghế.jpg")).toEqual(["mèo ngủ trên ghế"]);
    expect(tagsFromFileName("clip")).toEqual(["clip"]);
  });

  it("offers only matching uploads of the right kind, best and portrait first", () => {
    const assets = [
      asset("land", "orange-cat__sofa.mp4", { width: 1920, height: 1080 }),
      asset("port", "orange-cat__sofa.mp4", { width: 1080, height: 1920 }),
      asset("exact", "cat-on-sofa.mp4", { width: 1920, height: 1080 }),
      asset("photo", "orange-cat.jpg", { kind: "image" }),
      asset("stock", "pexels-1.mp4", { source: "pexels" }),
      asset("dog", "dog-running__beach.mp4"),
    ];
    expect(searchProjectAssets(assets, "cat on sofa", "video").map((a) => a.id)).toEqual([
      "exact",
      "port",
      "land",
    ]);
    expect(searchProjectAssets(assets, "orange cat", "image").map((a) => a.id)).toEqual(["photo"]);
    expect(searchProjectAssets(assets, "city traffic", "video")).toEqual([]);
  });
});

describe("capOwnCandidates", () => {
  const own = (n: number) =>
    Array.from({ length: n }, (_, i) => candidate("library", `lib_${String(i)}`, 1080, 1920));
  const stock = (n: number) =>
    Array.from({ length: n }, (_, i) => candidate("pexels", `p${String(i)}`, 1080, 1920));
  const refs = (list: MediaCandidate[]) => list.map((c) => c.ref);

  it("keeps places for stock when own files would fill the list", () => {
    expect(refs(capOwnCandidates([...own(8), ...stock(8)], 10, 5))).toEqual([
      ...refs(own(5)),
      ...refs(stock(5)),
    ]);
  });

  it("gives places stock cannot fill back to own files", () => {
    expect(refs(capOwnCandidates([...own(8), ...stock(2)], 10, 5))).toEqual([
      ...refs(own(8)),
      ...refs(stock(2)),
    ]);
    expect(refs(capOwnCandidates(own(3), 10, 5))).toEqual(refs(own(3)));
    expect(isOwnCandidate(candidate("project", "ast_1", 1080, 1920))).toBe(true);
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
      sources: ["project", "library", "pexels", "pixabay"],
    });
    expect(MediaSearchQuerySchema.safeParse({ query: "", kind: "video" }).success).toBe(false);
  });
});
