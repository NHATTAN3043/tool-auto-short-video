import type { LibrarySfx } from "@studio/domain";

/** Metadata of the shared sound effect library. Files live in StoragePort under `library/sfx/`. */
export interface SfxLibraryRepository {
  /** Newest first. */
  list(): Promise<LibrarySfx[]>;
  /** Throws DomainError SFX_NOT_FOUND. */
  get(id: string): Promise<LibrarySfx>;
  add(item: LibrarySfx): Promise<LibrarySfx>;
  /** Throws DomainError SFX_NOT_FOUND. */
  rename(id: string, name: string): Promise<LibrarySfx>;
  /** Throws DomainError SFX_NOT_FOUND. */
  remove(id: string): Promise<void>;
}
