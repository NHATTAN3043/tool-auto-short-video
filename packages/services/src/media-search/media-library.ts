import {
  contentTypeForFileName,
  DomainError,
  normalizeTags,
  parseByteRange,
  type LibraryMedia,
} from "@studio/domain";

import type { ReadProjectFileResult } from "../media/read-project-file";
import type { MediaLibraryRepository } from "../ports/media-library";
import type { StoragePort } from "../ports/storage";
import { libraryMediaKey } from "./import-candidate";

export function makeListLibraryMedia(deps: { library: MediaLibraryRepository }) {
  return () => deps.library.list();
}

export function makeSetLibraryMediaTags(deps: { library: MediaLibraryRepository }) {
  return (input: { id: string; tags: readonly string[] }): Promise<LibraryMedia> =>
    deps.library.setTags(input.id, normalizeTags(input.tags));
}

/** Removes the item from the shared library only; projects keep their own copies. */
export function makeRemoveLibraryMedia(deps: { library: MediaLibraryRepository; storage: StoragePort }) {
  return async (id: string): Promise<void> => {
    const item = await deps.library.get(id);
    await deps.library.remove(id);
    await deps.storage.remove(libraryMediaKey(item.path));
    if (item.thumbnailPath) await deps.storage.remove(libraryMediaKey(item.thumbnailPath));
  };
}

async function* nothing(): AsyncIterable<Uint8Array> {}

/** Streams a library file or its thumbnail for the browser, with HTTP Range support. */
export function makeReadLibraryMediaFile(deps: { library: MediaLibraryRepository; storage: StoragePort }) {
  return async (input: {
    id: string;
    file: "media" | "thumbnail";
    range?: string | null;
  }): Promise<ReadProjectFileResult> => {
    const item = await deps.library.get(input.id);
    const relative = input.file === "thumbnail" ? item.thumbnailPath : item.path;
    if (relative === undefined) throw new DomainError("FILE_NOT_FOUND", "File not found");
    const key = libraryMediaKey(relative);
    const info = await deps.storage.stat(key).catch(() => null);
    if (!info) throw new DomainError("FILE_NOT_FOUND", "File not found");
    const range = parseByteRange(input.range, info.size);
    if (range === "invalid") return { status: 416, size: info.size };
    const { start, end } = range ?? { start: 0, end: info.size - 1 };
    return {
      status: range ? 206 : 200,
      contentType: contentTypeForFileName(relative),
      immutable: true,
      size: info.size,
      start,
      end,
      body: info.size === 0 ? nothing() : deps.storage.read(key, { start, end }),
    };
  };
}
