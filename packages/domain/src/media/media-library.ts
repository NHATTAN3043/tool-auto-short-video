import { z } from "zod";

import { normalizeWhitespace } from "../text/words";

// The shared media library: stock videos and images downloaded once and reused by every project. Like the
// sound effect library, a project never points into it; using an item copies the file into the project.

export const MEDIA_LIBRARY_SCHEMA_VERSION = 1;
export const MEDIA_TAG_MAX_LENGTH = 60;
export const MEDIA_MAX_TAGS = 20;

export const StockProviderSchema = z.enum(["pexels", "pixabay"]);
export type StockProvider = z.infer<typeof StockProviderSchema>;

export const LibraryMediaSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["video", "image"]),
  fileName: z.string().min(1),
  /** Relative to the library folder, e.g. `files/lib_1.mp4`. */
  path: z.string().min(1),
  thumbnailPath: z.string().min(1).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  hasAudio: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(MEDIA_TAG_MAX_LENGTH)).max(MEDIA_MAX_TAGS),
  /** How many times the item was copied into a project. */
  usageCount: z.number().int().nonnegative(),
  source: StockProviderSchema,
  /** `pexels:video:123`: the same stock file is downloaded only once. */
  sourceRef: z.string().min(1),
  contentHash: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type LibraryMedia = z.infer<typeof LibraryMediaSchema>;

export const MediaLibrarySchema = z.object({
  schemaVersion: z.literal(MEDIA_LIBRARY_SCHEMA_VERSION),
  items: z.array(LibraryMediaSchema),
});
export type MediaLibrary = z.infer<typeof MediaLibrarySchema>;

/** Lower-case, single-spaced, unique, at most MEDIA_MAX_TAGS. */
export function normalizeTags(tags: readonly string[]): string[] {
  const result: string[] = [];
  for (const raw of tags) {
    const tag = normalizeWhitespace(raw).toLocaleLowerCase().slice(0, MEDIA_TAG_MAX_LENGTH);
    if (tag !== "" && !result.includes(tag)) result.push(tag);
    if (result.length === MEDIA_MAX_TAGS) break;
  }
  return result;
}

/** `pexels:video:123` */
export function stockSourceRef(provider: StockProvider, kind: "video" | "image", id: string): string {
  return `${provider}:${kind}:${id}`;
}
