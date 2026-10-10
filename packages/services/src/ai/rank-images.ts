import { fileExtension, type MediaRankRequest } from "@studio/domain";

import type { RankImage } from "../ports/ai";
import type { MediaLibraryRepository } from "../ports/media-library";
import type { MediaSearchPort } from "../ports/media-search";
import type { StoragePort } from "../ports/storage";
import { libraryMediaKey } from "../media-search/import-candidate";

/** Larger thumbnails are skipped; the API accepts at most 5 MB per image. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const MEDIA_TYPES: Record<string, Extract<RankImage, { type: "base64" }>["mediaType"]> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type ResolveRankImages = (request: MediaRankRequest) => Promise<Map<string, RankImage>>;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * The thumbnails of a vision ranking, by candidate key. A stock thumbnail is sent as its link, and only
 * when it is on a provider's media host (the request may come from the browser); a library item is read
 * from storage. Text mode needs no image. A thumbnail that cannot be used is skipped, not an error.
 */
export function makeResolveRankImages(deps: {
  library: MediaLibraryRepository;
  storage: StoragePort;
  providers: readonly MediaSearchPort[];
}): ResolveRankImages {
  async function libraryImage(id: string): Promise<RankImage | null> {
    const item = await deps.library.get(id).catch(() => null);
    const relative = item?.thumbnailPath ?? (item?.kind === "image" ? item.path : undefined);
    const mediaType = relative === undefined ? undefined : MEDIA_TYPES[fileExtension(relative) ?? ""];
    if (relative === undefined || mediaType === undefined) return null;
    const key = libraryMediaKey(relative);
    const size = (await deps.storage.stat(key))?.size;
    if (size === undefined || size > MAX_IMAGE_BYTES) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of deps.storage.read(key)) chunks.push(chunk);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return { type: "base64", mediaType, data: toBase64(bytes) };
  }

  function remoteImage(url: string): RankImage | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") return null;
    return deps.providers.some((provider) => provider.isProxyUrl(parsed))
      ? { type: "url", url: parsed.href }
      : null;
  }

  return async (request) => {
    const images = new Map<string, RankImage>();
    if (request.mode !== "vision") return images;
    for (const scene of request.scenes) {
      for (const candidate of scene.candidates) {
        if (images.has(candidate.key)) continue;
        const link = candidate.thumbnail;
        const image = link.type === "remote" ? remoteImage(link.url) : await libraryImage(link.id);
        if (image) images.set(candidate.key, image);
      }
    }
    return images;
  };
}
