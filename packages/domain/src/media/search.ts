import { z } from "zod";

import type { LibraryMedia } from "./media-library";

// Searching media for a scene: the shared library first, then free stock providers.

export const SearchLanguageSchema = z.enum(["en", "vi", "zh"]);
export type SearchLanguage = z.infer<typeof SearchLanguageSchema>;

export const MediaSourceFilterSchema = z.enum(["library", "pexels", "pixabay"]);
export type MediaSourceFilter = z.infer<typeof MediaSourceFilterSchema>;

export const MediaSearchQuerySchema = z.object({
  query: z.string().trim().min(1).max(100),
  kind: z.enum(["video", "image"]),
  /** Language of the query; stock providers are told so they can translate. */
  lang: SearchLanguageSchema.default("en"),
  sources: z.array(MediaSourceFilterSchema).min(1).default(["library", "pexels", "pixabay"]),
});
export type MediaSearchQuery = z.infer<typeof MediaSearchQuerySchema>;

/** A file the UI can show: from a stock CDN (proxied by the server) or from the shared library. */
export const MediaLinkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("remote"), url: z.url() }),
  z.object({ type: z.literal("library"), id: z.string().min(1), file: z.enum(["thumbnail", "media"]) }),
]);
export type MediaLink = z.infer<typeof MediaLinkSchema>;

export const MediaCandidateSchema = z.object({
  provider: MediaSourceFilterSchema,
  /** Library item id, or the provider's own id of the stock file. */
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
});
export type MediaCandidate = z.infer<typeof MediaCandidateSchema>;

/** Identifies a candidate across sources: `library:video:lib_1`, `pexels:image:123`. */
export function candidateKey(candidate: Pick<MediaCandidate, "provider" | "kind" | "ref">): string {
  return `${candidate.provider}:${candidate.kind}:${candidate.ref}`;
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

function words(text: string): string[] {
  return foldText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/**
 * How well a library item matches a query, 0 = not at all. A whole tag equal to the query beats single
 * words; Chinese has no spaces, so a tag that contains the query (or the other way round) also counts.
 */
export function scoreLibraryItem(item: Pick<LibraryMedia, "tags" | "kind">, query: string): number {
  const folded = foldText(query.trim());
  if (folded === "") return 0;
  const tags = item.tags.map(foldText);
  if (tags.includes(folded)) return 100;
  let score = 0;
  if (tags.some((tag) => tag.includes(folded) || folded.includes(tag))) score += 40;
  const queryWords = new Set(words(folded));
  const tagWords = new Set(tags.flatMap(words));
  for (const word of queryWords) if (tagWords.has(word)) score += 10;
  return score;
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
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(portraitItem(b.item)) - Number(portraitItem(a.item)) ||
        b.item.usageCount - a.item.usageCount,
    )
    .map(({ item }) => item);
}

/**
 * Final order: library first, then stock providers taking turns, portrait before landscape within each
 * provider. Stock files already in the library are not shown twice.
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
