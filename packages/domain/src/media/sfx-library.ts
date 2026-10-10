import { z } from "zod";

// The sound effect library is shared by every project. A project never points into it: picking an
// effect copies the file into the project as a normal audio asset, so a project folder stays self-contained.

export const SFX_LIBRARY_SCHEMA_VERSION = 1;

export const SFX_NAME_MAX_LENGTH = 80;

export const LibrarySfxSchema = z.object({
  id: z.string().min(1),
  /** Display name; starts as the file name without extension. */
  name: z.string().trim().min(1).max(SFX_NAME_MAX_LENGTH),
  fileName: z.string().min(1),
  /** Relative to the library folder, e.g. `files/lib_1.mp3`. */
  path: z.string().min(1),
  durationMs: z.number().int().nonnegative().optional(),
  contentHash: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type LibrarySfx = z.infer<typeof LibrarySfxSchema>;

export const SfxLibrarySchema = z.object({
  schemaVersion: z.literal(SFX_LIBRARY_SCHEMA_VERSION),
  items: z.array(LibrarySfxSchema),
});
export type SfxLibrary = z.infer<typeof SfxLibrarySchema>;

/** `ting-ting.mp3` → `ting-ting`. */
export function sfxNameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/u, "").trim();
  return (base === "" ? fileName : base).slice(0, SFX_NAME_MAX_LENGTH);
}
