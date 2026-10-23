import {
  belongsInLibrary,
  fileExtension,
  newId,
  tagsFromFileName,
  uploadSourceRef,
  type IdGenerator,
  type LibraryMedia,
  type MediaAsset,
} from "@studio/domain";

import type { Clock } from "../ports/clock";
import type { MediaLibraryRepository } from "../ports/media-library";
import type { StoragePort } from "../ports/storage";
import { KeyedLock } from "../shared/keyed-lock";
import { libraryMediaKey } from "./import-candidate";

export interface AddUploadToLibraryResult {
  item: LibraryMedia;
  /** False when the same file was already in the library (uploaded before, here or in another project). */
  created: boolean;
}

/**
 * Copies a video the user uploaded into a project to the shared library, so every project can find it and it
 * is analyzed only once. The same file (same content hash) is stored once, whichever project uploads it. The
 * project's own copy is not touched.
 */
export function makeAddUploadToLibrary(deps: {
  library: MediaLibraryRepository;
  storage: StoragePort;
  clock: Clock;
  newId?: IdGenerator;
}) {
  const lock = new KeyedLock();
  return (input: { projectId: string; asset: MediaAsset }): Promise<AddUploadToLibraryResult> => {
    const { asset } = input;
    const contentHash = asset.contentHash;
    const extension = fileExtension(asset.fileName) ?? fileExtension(asset.path);
    if (!belongsInLibrary(asset) || contentHash === undefined || extension === null) {
      return Promise.reject(new Error(`${asset.fileName} cannot go to the library`));
    }
    const sourceRef = uploadSourceRef(contentHash);
    // The same file uploaded twice at once must be copied once.
    return lock.run(sourceRef, async () => {
      const existing = await deps.library.findBySourceRef(sourceRef);
      if (existing) return { item: existing, created: false };

      const id = (deps.newId ?? newId)("lib");
      const path = `files/${id}.${extension}`;
      const thumbnailPath = `thumbnails/${id}.jpg`;
      const projectKey = `projects/${input.projectId}`;
      const written: string[] = [];
      try {
        // Noted before writing, so a copy that fails halfway is removed too.
        written.push(libraryMediaKey(path));
        await deps.storage.write(libraryMediaKey(path), deps.storage.read(`${projectKey}/${asset.path}`));
        const item: LibraryMedia = {
          id,
          kind: "video",
          fileName: asset.fileName,
          path,
          tags: tagsFromFileName(asset.fileName),
          usageCount: 0,
          source: "upload",
          sourceRef,
          contentHash,
          createdAt: deps.clock.now(),
        };
        if (asset.thumbnailPath) {
          written.push(libraryMediaKey(thumbnailPath));
          await deps.storage.write(
            libraryMediaKey(thumbnailPath),
            deps.storage.read(`${projectKey}/${asset.thumbnailPath}`),
          );
          item.thumbnailPath = thumbnailPath;
        }
        if (asset.durationMs !== undefined) item.durationMs = asset.durationMs;
        if (asset.width !== undefined) item.width = asset.width;
        if (asset.height !== undefined) item.height = asset.height;
        if (asset.hasAudio !== undefined) item.hasAudio = asset.hasAudio;
        return { item: await deps.library.add(item), created: true };
      } catch (error) {
        await Promise.all(written.map((key) => deps.storage.remove(key)));
        throw error;
      }
    });
  };
}

export type AddUploadToLibrary = ReturnType<typeof makeAddUploadToLibrary>;
