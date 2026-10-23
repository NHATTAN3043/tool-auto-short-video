import { z } from "zod";

import type { ClipShot } from "./clip-analysis";
import { normalizeTags, type LibraryMedia } from "./media-library";
import type { MediaAsset } from "./schema";

// Searching media for a scene: the project's own uploads first, then the shared library, then free stock
// providers.

export const SearchLanguageSchema = z.enum(["en", "vi", "zh"]);
export type SearchLanguage = z.infer<typeof SearchLanguageSchema>;

export const MediaSourceFilterSchema = z.enum(["project", "library", "pexels", "pixabay"]);
export type MediaSourceFilter = z.infer<typeof MediaSourceFilterSchema>;

export const MediaSearchQuerySchema = z.object({
  query: z.string().trim().min(1).max(100),
  kind: z.enum(["video", "image"]),
  /** Language of the query; stock providers are told so they can translate. */
  lang: SearchLanguageSchema.default("en"),
  sources: z.array(MediaSourceFilterSchema).min(1).default(["project", "library", "pexels", "pixabay"]),
});
export type MediaSearchQuery = z.infer<typeof MediaSearchQuerySchema>;

/**
 * A file the UI can show: from a stock CDN (proxied by the server), the shared library, or the project's
 * own uploads. `path` of a project file is only for the browser; the server finds the file by asset id.
 */
export const MediaLinkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("remote"), url: z.url() }),
  z.object({
    type: z.literal("library"),
    id: z.string().min(1),
    file: z.enum(["thumbnail", "media", "shot"]),
    /** With `file: "shot"`: the still of that shot of an analyzed video (ADR 0019). */
    shot: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("project"),
    projectId: z.string().min(1),
    assetId: z.string().min(1),
    path: z.string().min(1),
  }),
]);
export type MediaLink = z.infer<typeof MediaLinkSchema>;

/** One shot of an analyzed clip (ADR 0019): choosing it starts the scene at `startMs`. */
export const MediaSegmentSchema = z.object({
  index: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
});
export type MediaSegment = z.infer<typeof MediaSegmentSchema>;

export const MediaCandidateSchema = z.object({
  provider: MediaSourceFilterSchema,
  /** Project asset id, library item id, or the provider's own id of the stock file. */
  ref: z.string().min(1),
  kind: z.enum(["video", "image"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().nonnegative().optional(),
  thumbnail: MediaLinkSchema,
  /** A small rendition to play before choosing. */
  preview: MediaLinkSchema.optional(),
  /** Stock candidate already downloaded into the library: using it copies, it does not download again. */
  libraryId: z.string().min(1).optional(),
  /** What the provider says the file shows (alt text, tags, library tags); used to rank by text. */
  description: z.string().max(500).optional(),
  /** Set when the candidate is one shot of a clip rather than the whole file. */
  segment: MediaSegmentSchema.optional(),
  /** The shot has burnt-in text, subtitles or another channel's logo: picked only when nothing clean fits. */
  textOverlay: z.boolean().optional(),
});
export type MediaCandidate = z.infer<typeof MediaCandidateSchema>;

/**
 * Identifies a candidate across sources: `library:video:lib_1`, `pexels:image:123`; one shot of a clip adds
 * its number, `library:video:lib_1#3`.
 */
export function candidateKey(
  candidate: Pick<MediaCandidate, "provider" | "kind" | "ref"> & { segment?: Pick<MediaSegment, "index"> },
): string {
  const key = `${candidate.provider}:${candidate.kind}:${candidate.ref}`;
  return candidate.segment ? `${key}#${String(candidate.segment.index)}` : key;
}

/**
 * How AI ranks media candidates: `text` reads their descriptions (cheap), `vision` looks at their
 * thumbnails (more accurate, several times the cost).
 */
export const MediaRankingModeSchema = z.enum(["text", "vision"]);
export type MediaRankingMode = z.infer<typeof MediaRankingModeSchema>;

/** What the browser sends back when the user picks a candidate: never a URL. */
export const PickedCandidateSchema = z.object({
  provider: MediaSourceFilterSchema,
  ref: z.string().min(1),
  kind: z.enum(["video", "image"]),
  /** The shot of an analyzed clip; the server reads its times from the library, never from the request. */
  segmentIndex: z.number().int().nonnegative().optional(),
});
export type PickedCandidate = z.infer<typeof PickedCandidateSchema>;

export function isPortrait(candidate: Pick<MediaCandidate, "width" | "height">): boolean {
  return candidate.height > candidate.width;
}

function portraitItem(item: Pick<LibraryMedia, "width" | "height">): boolean {
  return (item.height ?? 0) > (item.width ?? 0);
}

/** Lower-case without Vietnamese accents, so "mèo con" matches "meo con". */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/[đĐ]/gu, "d").toLocaleLowerCase();
}

/**
 * Words that say nothing about a picture (folded, so the Vietnamese ones are without accents). A query
 * and a tag sharing only "the" or "in" are not a match.
 */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "va",
  "cua",
  "la",
  "cac",
  "nhung",
  "mot",
  "voi",
  "trong",
  "tren",
  "cho",
]);

function words(text: string): string[] {
  return foldText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "" && !STOP_WORDS.has(word));
}

/**
 * Below this a tag match is too weak to offer: one shared word is not enough; two words, a tag inside the
 * query (or the other way round), or the whole tag are.
 */
export const MIN_MATCH_SCORE = 20;

/**
 * How well tags match a query, 0 = not at all. A whole tag equal to the query beats single words; Chinese
 * has no spaces, so a tag that contains the query (or the other way round) also counts.
 */
export function scoreTags(rawTags: readonly string[], query: string): number {
  const folded = foldText(query.trim());
  if (folded === "") return 0;
  const tags = rawTags.map(foldText).filter((tag) => tag !== "" && !STOP_WORDS.has(tag));
  if (tags.includes(folded)) return 100;
  let score = 0;
  if (tags.some((tag) => tag.includes(folded) || folded.includes(tag))) score += 40;
  const queryWords = new Set(words(folded));
  const tagWords = new Set(tags.flatMap(words));
  for (const word of queryWords) if (tagWords.has(word)) score += 10;
  return score;
}

export function scoreLibraryItem(item: Pick<LibraryMedia, "tags" | "kind">, query: string): number {
  return scoreTags(item.tags, query);
}

/** A description's words count half as much as a tag's: tags are the words chosen for searching. */
const DESCRIPTION_WORD_SCORE = 5;

/** How well one shot of an analyzed clip matches a query: its tags, plus the words of its description. */
export function scoreShot(shot: Pick<ClipShot, "tags" | "description">, query: string): number {
  const described = new Set(words(shot.description));
  const shared = [...new Set(words(query))].filter((word) => described.has(word)).length;
  return scoreTags(shot.tags, query) + DESCRIPTION_WORD_SCORE * shared;
}

/**
 * A library match: the whole item, or one shot of an analyzed video. An analyzed video is matched by its
 * shots only, since the shots say what is in it far better than the tags of its file name.
 */
export interface LibraryMatch {
  item: LibraryMedia;
  shot?: ClipShot;
  score: number;
}

function libraryMatches(item: LibraryMedia, query: string): LibraryMatch[] {
  if (item.analysis) {
    return item.analysis.shots.map((shot) => ({ item, shot, score: scoreShot(shot, query) }));
  }
  return [{ item, score: scoreLibraryItem(item, query) }];
}

/**
 * Best library matches of the right kind, shots included: by score, then clean shots before shots with
 * burnt-in text, portrait items, and more-used items.
 */
export function searchLibraryMatches(
  items: readonly LibraryMedia[],
  query: string,
  kind: "video" | "image",
): LibraryMatch[] {
  return items
    .filter((item) => item.kind === kind)
    .flatMap((item) => libraryMatches(item, query))
    .filter(({ score }) => score >= MIN_MATCH_SCORE)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(a.shot?.textOverlay === true) - Number(b.shot?.textOverlay === true) ||
        Number(portraitItem(b.item)) - Number(portraitItem(a.item)) ||
        b.item.usageCount - a.item.usageCount,
    );
}

/**
 * The order Full AI tries a scene's usable candidates in (ADR 0019): the ranked order, but shots already
 * given to another scene are left out (the same moment twice looks like a mistake), and shots with burnt-in
 * text come after every clean candidate.
 */
export function selectionOrder(
  candidates: readonly MediaCandidate[],
  usedKeys: ReadonlySet<string>,
): MediaCandidate[] {
  const fresh = candidates.filter(
    (candidate) => !candidate.segment || !usedKeys.has(candidateKey(candidate)),
  );
  return [
    ...fresh.filter((candidate) => candidate.textOverlay !== true),
    ...fresh.filter((candidate) => candidate.textOverlay === true),
  ];
}

/**
 * Tags written in an uploaded file's name: `__` separates tags; `-`, `_` and `.` separate words.
 * `cat-sleeping__orange-cat__sofa.mp4` → ["cat sleeping", "orange cat", "sofa"].
 */
export function tagsFromFileName(fileName: string): string[] {
  const base = fileName.replace(/\.[^./\\]+$/u, "");
  return normalizeTags(base.split("__").map((part) => part.replace(/[-_.]+/gu, " ")));
}

/**
 * Best matches among the project's own uploads, by the tags in their file names, portrait first. Stock
 * copies and voice files are not offered: the library and the providers already find the stock ones.
 */
export function searchProjectAssets(
  assets: readonly MediaAsset[],
  query: string,
  kind: "video" | "image",
): MediaAsset[] {
  return assets
    .filter((asset) => asset.source === "upload" && asset.kind === kind)
    .map((asset) => ({ asset, score: scoreTags(tagsFromFileName(asset.fileName), query) }))
    .filter(({ score }) => score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score || Number(portraitItem(b.asset)) - Number(portraitItem(a.asset)))
    .map(({ asset }) => asset);
}

/**
 * A video uploaded into the project is also in the shared library (ADR 0019), so the same file would be
 * offered twice. The library item wins once it is analyzed, since its shots say what is in it; until then
 * the project file wins, since using it copies nothing. Only uploads count on the project side: stock
 * copies are never offered as project files, so their library item must stay.
 */
export function ownTwinFilters(
  projectAssets: readonly Pick<MediaAsset, "contentHash" | "source">[],
  libraryItems: readonly Pick<LibraryMedia, "contentHash" | "analysis">[],
): {
  keepAsset: (asset: Pick<MediaAsset, "contentHash">) => boolean;
  keepItem: (item: Pick<LibraryMedia, "contentHash" | "analysis">) => boolean;
} {
  const inProject = new Set(
    projectAssets.flatMap((asset) => (asset.source === "upload" ? (asset.contentHash ?? []) : [])),
  );
  const analyzed = new Set(libraryItems.filter((item) => item.analysis).map((item) => item.contentHash));
  return {
    keepAsset: (asset) => asset.contentHash === undefined || !analyzed.has(asset.contentHash),
    keepItem: (item) => item.analysis !== undefined || !inProject.has(item.contentHash),
  };
}

/** Best library matches of the right kind, portrait and more-used first. */
export function searchLibrary(
  items: readonly LibraryMedia[],
  query: string,
  kind: "video" | "image",
): LibraryMedia[] {
  return items
    .filter((item) => item.kind === kind)
    .map((item) => ({ item, score: scoreLibraryItem(item, query) }))
    .filter(({ score }) => score >= MIN_MATCH_SCORE)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(portraitItem(b.item)) - Number(portraitItem(a.item)) ||
        b.item.usageCount - a.item.usageCount,
    )
    .map(({ item }) => item);
}

/**
 * Final order: own files first (as given: project uploads, then the library), then stock providers taking
 * turns, portrait before landscape within each provider. Stock files already in the library are not shown
 * twice.
 */
export function rankCandidates(
  library: readonly MediaCandidate[],
  stock: readonly (readonly MediaCandidate[])[],
): MediaCandidate[] {
  const inLibrary = new Set(library.map((candidate) => candidate.ref));
  const sorted = stock.map((list) =>
    list
      .filter((candidate) => candidate.libraryId === undefined || !inLibrary.has(candidate.libraryId))
      .map((candidate, index) => ({ candidate, index }))
      .sort((a, b) => Number(isPortrait(b.candidate)) - Number(isPortrait(a.candidate)) || a.index - b.index)
      .map(({ candidate }) => candidate),
  );
  const result = [...library];
  const longest = Math.max(0, ...sorted.map((list) => list.length));
  for (let i = 0; i < longest; i += 1) {
    for (const list of sorted) {
      const candidate = list[i];
      if (candidate) result.push(candidate);
    }
  }
  return result;
}

/** A file the user already has: a project upload or a shared library item, as opposed to stock. */
export const isOwnCandidate = (candidate: Pick<MediaCandidate, "provider">) =>
  candidate.provider === "project" || candidate.provider === "library";

/**
 * At most `max` candidates, of which at most `maxOwn` are own files (project uploads, library), so stock
 * always gets places to be compared against. Places that stock cannot fill go back to own files. The order
 * is kept.
 */
export function capOwnCandidates(
  candidates: readonly MediaCandidate[],
  max: number,
  maxOwn: number,
): MediaCandidate[] {
  const own = candidates.filter(isOwnCandidate);
  const stock = candidates.filter((candidate) => !isOwnCandidate(candidate));
  const ownCount = Math.min(own.length, Math.max(maxOwn, max - stock.length));
  const kept = new Set([...own.slice(0, ownCount), ...stock.slice(0, max - ownCount)]);
  return candidates.filter((candidate) => kept.has(candidate));
}

export interface Rendition {
  width: number;
  height: number;
  url: string;
}

/**
 * The file to download: the smallest one whose short side reaches 1080, else the largest below that.
 * 4K is never needed for a 1080×1920 video and only costs disk and render time.
 */
export function pickRendition<T extends Rendition>(renditions: readonly T[]): T | undefined {
  const shortSide = (r: Rendition) => Math.min(r.width, r.height);
  const enough = renditions.filter((r) => shortSide(r) >= 1080).sort((a, b) => shortSide(a) - shortSide(b));
  if (enough[0]) return enough[0];
  return [...renditions].sort((a, b) => shortSide(b) - shortSide(a))[0];
}

/** The smallest rendition, for playing before choosing. */
export function pickPreviewRendition<T extends Rendition>(renditions: readonly T[]): T | undefined {
  return [...renditions].sort((a, b) => a.width * a.height - b.width * b.height)[0];
}
