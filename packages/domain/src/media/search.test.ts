import { describe, expect, it } from "vitest";

import type { ClipShot } from "./clip-analysis";
import { normalizeTags, stockSourceRef, uploadSourceRef, type LibraryMedia } from "./media-library";
import type { MediaAsset } from "./schema";
import {
  candidateKey,
  capOwnCandidates,
  foldText,
  isOwnCandidate,
  MediaSearchQuerySchema,
  MIN_MATCH_SCORE,
  pickPreviewRendition,
  pickRendition,
  rankCandidates,
  scoreLibraryItem,
  scoreShot,
  scoreTags,
  searchLibrary,
  searchLibraryMatches,
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

const clipShot = (index: number, tags: string[], description: string, textOverlay = false): ClipShot => ({
  index,
  startMs: index * 3000,
  endMs: (index + 1) * 3000,
  description,
  tags,
  textOverlay,
});

const analyzed = (id: string, shots: ClipShot[], extra: Partial<LibraryMedia> = {}): LibraryMedia =>
  item(id, ["7389101112"], {
    source: "upload",
    contentHash: `sha256:${id}`,
    sourceRef: uploadSourceRef(`sha256:${id}`),
    analysis: { shots, model: "claude-sonnet-5-5", analyzedAt: "2026-10-23T00:00:00.000Z" },
    ...extra,
  });

describe("scoreShot / searchLibraryMatches", () => {
  it("scores a shot by its tags plus half a point per word of its description", () => {
    const sleeping = clipShot(0, ["orange cat"], "An orange cat sleeping on a sofa");
    expect(scoreShot(sleeping, "orange cat")).toBe(100 + 10);
    expect(scoreShot(sleeping, "cat sleeping")).toBe(scoreTags(["orange cat"], "cat sleeping") + 10);
  });

  it("ranks a whole-tag match first and drops a shot matching only by description", () => {
    const clip = analyzed("lib_a", [
      clipShot(0, ["dog"], "A cat and a dog sleeping together"),
      clipShot(1, ["cat"], "A cat sleeping on a sofa"),
      clipShot(2, ["cat sleeping"], "Close-up of a cat"),
    ]);
    // 2: whole tag 100 + "cat" 5; 1: tag inside the query 40 + "cat" 10 + description 10; 0: description 10 only.
    const matches = searchLibraryMatches([clip], "cat sleeping", "video");
    expect(matches.map((match) => [match.shot?.index, match.score])).toEqual([
      [2, 105],
      [1, 60],
    ]);
  });

  it("matches an analyzed video by its shots only, not by the tags of its file name", () => {
    const clip = analyzed("lib_a", [clipShot(0, ["beach"], "Waves on a beach")]);
    expect(searchLibraryMatches([clip], "7389101112", "video")).toEqual([]);
    expect(searchLibraryMatches([clip], "beach", "video")).toHaveLength(1);
  });

  it("offers shots with burnt-in text after clean shots of the same score", () => {
    const clip = analyzed("lib_a", [
      clipShot(0, ["street food"], "Street food stall", true),
      clipShot(1, ["street food"], "Street food stall"),
    ]);
    expect(searchLibraryMatches([clip], "street food", "video").map((match) => match.shot?.index)).toEqual([
      1, 0,
    ]);
  });

  it("keeps the score threshold and mixes shots with unanalyzed items", () => {
    const clip = analyzed("lib_a", [clipShot(0, ["cat"], "A cat"), clipShot(1, ["car"], "A red car")]);
    const plain = item("lib_b", ["cat sleeping"]);
    const matches = searchLibraryMatches([clip, plain], "cat sleeping", "video");
    expect(matches.map((match) => [match.item.id, match.shot?.index])).toEqual([
      ["lib_b", undefined],
      ["lib_a", 0],
    ]);
    expect(matches.every((match) => match.score >= MIN_MATCH_SCORE)).toBe(true);
  });
});

describe("candidateKey", () => {
  it("tells two shots of one clip apart and keeps whole-file keys as before", () => {
    const whole = candidate("library", "lib_1", 1080, 1920);
    const third: MediaCandidate = { ...whole, segment: { index: 3, startMs: 9000, endMs: 12_000 } };
    expect(candidateKey(whole)).toBe("library:video:lib_1");
    expect(candidateKey(third)).toBe("library:video:lib_1#3");
  });
});
