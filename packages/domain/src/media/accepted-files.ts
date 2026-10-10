import type { MediaKind } from "./schema";

/** File types the studio accepts, by kind. Anything else is rejected before it touches the disk. */
export const ACCEPTED_EXTENSIONS: Readonly<Record<MediaKind, readonly string[]>> = {
  video: ["mp4", "mov", "webm"],
  image: ["jpg", "jpeg", "png", "webp"],
  audio: ["mp3", "wav", "m4a"],
};

/** Lower-case extension without the dot, or null when the name has none. */
export function fileExtension(fileName: string): string | null {
  const match = /\.([A-Za-z0-9]+)$/u.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

export function mediaKindFromFileName(fileName: string): MediaKind | null {
  const extension = fileExtension(fileName);
  if (extension === null) return null;
  for (const [kind, extensions] of Object.entries(ACCEPTED_EXTENSIONS) as [MediaKind, readonly string[]][]) {
    if (extensions.includes(extension)) return kind;
  }
  return null;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ttf: "font/ttf",
  srt: "text/plain; charset=utf-8",
  zip: "application/zip",
};

/** MIME type used when serving a stored file; unknown extensions are served as opaque bytes. */
export function contentTypeForFileName(fileName: string): string {
  return CONTENT_TYPES[fileExtension(fileName) ?? ""] ?? "application/octet-stream";
}
