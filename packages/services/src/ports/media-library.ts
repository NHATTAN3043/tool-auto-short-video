import type { LibraryMedia } from "@studio/domain";

/** Metadata of the shared media library. Files live in StoragePort under `library/media/`. */
export interface MediaLibraryRepository {
  /** Newest first. */
  list(): Promise<LibraryMedia[]>;
  /** Throws DomainError LIBRARY_MEDIA_NOT_FOUND. */
  get(id: string): Promise<LibraryMedia>;
  findBySourceRef(sourceRef: string): Promise<LibraryMedia | null>;
  /** Throws INVALID_OPERATION when the id or the sourceRef already exists. */
  add(item: LibraryMedia): Promise<LibraryMedia>;
  /** Throws LIBRARY_MEDIA_NOT_FOUND. */
  setTags(id: string, tags: readonly string[]): Promise<LibraryMedia>;
  /** Throws LIBRARY_MEDIA_NOT_FOUND. */
  incrementUsage(id: string): Promise<LibraryMedia>;
  /** Throws LIBRARY_MEDIA_NOT_FOUND. */
  remove(id: string): Promise<void>;
}
