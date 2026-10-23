import { fileExtension, type MediaRankRequest } from "@studio/domain";

import type { RankImage } from "../ports/ai";
import type { MediaLibraryRepository } from "../ports/media-library";
import type { MediaSearchPort } from "../ports/media-search";
import type { ProjectRepository } from "../ports/project-repository";
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

/** An image file from storage as base64 for the AI; null when its type or size cannot be sent. */
export async function readStoredImage(storage: StoragePort, key: string): Promise<RankImage | null> {
  const mediaType = MEDIA_TYPES[fileExtension(key) ?? ""];
  if (mediaType === undefined) return null;
  const size = (await storage.stat(key))?.size;
  if (size === undefined || size > MAX_IMAGE_BYTES) return null;
  const chunks: Uint8Array[] = [];
  for await (const chunk of storage.read(key)) chunks.push(chunk);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { type: "base64", mediaType, data: toBase64(bytes) };
}

/**
 * The thumbnails of a vision ranking, by candidate key. A stock thumbnail is sent as its link, and only
 * when it is on a provider's media host (the request may come from the browser); a library item or a
 * project upload is read from storage, found by its id (never by a path from the request). Text mode needs
 * no image. A thumbnail that cannot be used is skipped, not an error.
 */
export function makeResolveRankImages(deps: {
  library: MediaLibraryRepository;
  repo: ProjectRepository;
  storage: StoragePort;
  providers: readonly MediaSearchPort[];
}): ResolveRankImages {
  async function libraryImage(id: string, shot?: number): Promise<RankImage | null> {
    const item = await deps.library.get(id).catch(() => null);
    // A shot of an analyzed clip is judged by its own still, not by the clip's first second.
    const relative =
      shot !== undefined
        ? item?.analysis?.shots[shot]?.thumbnailPath
        : (item?.thumbnailPath ?? (item?.kind === "image" ? item.path : undefined));
    return relative === undefined ? null : storedImage(libraryMediaKey(relative));
  }

  async function projectImage(projectId: string, assetId: string): Promise<RankImage | null> {
    const project = await deps.repo.get(projectId).catch(() => null);
    const asset = project?.assets.find((candidate) => candidate.id === assetId);
    const relative = asset?.thumbnailPath ?? (asset?.kind === "image" ? asset.path : undefined);
    return relative === undefined ? null : storedImage(`projects/${projectId}/${relative}`);
  }

  const storedImage = (key: string) => readStoredImage(deps.storage, key);

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
        const image =
          link.type === "remote"
            ? remoteImage(link.url)
            : link.type === "library"
              ? await libraryImage(link.id, link.file === "shot" ? (link.shot ?? 0) : undefined)
              : await projectImage(link.projectId, link.assetId);
        if (image) images.set(candidate.key, image);
      }
    }
    return images;
  };
}
