import { z } from "zod";

export const MediaKindSchema = z.enum(["video", "image", "audio"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const MediaSourceSchema = z.enum(["upload", "library", "pexels", "pixabay", "tts", "generated"]);
export type MediaSource = z.infer<typeof MediaSourceSchema>;

export const MediaAssetSchema = z.object({
  id: z.string().min(1),
  kind: MediaKindSchema,
  source: MediaSourceSchema,
  fileName: z.string().min(1),
  path: z.string().min(1),
  thumbnailPath: z.string().min(1).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().optional(),
  hasAudio: z.boolean().optional(),
  attribution: z.string().optional(),
  contentHash: z.string().optional(),
  createdAt: z.iso.datetime(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
