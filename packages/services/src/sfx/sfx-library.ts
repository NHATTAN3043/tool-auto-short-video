import {
  addAsset,
  contentTypeForFileName,
  DomainError,
  fileExtension,
  mediaKindFromFileName,
  newId,
  parseByteRange,
  sfxNameFromFileName,
  type IdGenerator,
  type LibrarySfx,
  type MediaAsset,
  type Project,
} from "@studio/domain";

import { displayName, limited } from "../media/upload-stream";
import type { ReadProjectFileResult } from "../media/read-project-file";
import type { Clock } from "../ports/clock";
import type { MediaProbePort } from "../ports/media-probe";
import type { ProjectRepository } from "../ports/project-repository";
import type { SfxLibraryRepository } from "../ports/sfx-library";
import type { StoragePort } from "../ports/storage";

/** Storage folder of the shared library; `LibrarySfx.path` is relative to it. */
export const SFX_LIBRARY_ROOT = "library/sfx";

const libraryKey = (item: Pick<LibrarySfx, "path">) => `${SFX_LIBRARY_ROOT}/${item.path}`;

export interface ImportLibrarySfxDeps {
  library: SfxLibraryRepository;
  storage: StoragePort;
  probe: MediaProbePort;
  clock: Clock;
  newId?: IdGenerator;
  maxBytes?: number;
}

/** Stores an uploaded audio file in the shared library. Only audio files are accepted. */
export function makeImportLibrarySfx(deps: ImportLibrarySfxDeps) {
  return async (input: { fileName: string; data: AsyncIterable<Uint8Array> }): Promise<LibrarySfx> => {
    const fileName = displayName(input.fileName);
    const extension = fileExtension(fileName);
    if (mediaKindFromFileName(fileName) !== "audio" || extension === null) {
      throw new DomainError("INVALID_MEDIA", `Not an audio file: ${fileName}`);
    }
    const id = (deps.newId ?? newId)("lib");
    const path = `files/${id}.${extension}`;
    const key = libraryKey({ path });
    try {
      const written = await deps.storage.write(
        key,
        deps.maxBytes === undefined ? input.data : limited(input.data, deps.maxBytes),
      );
      if (written.bytes === 0) throw new DomainError("INVALID_MEDIA", "The file is empty");
      let probed;
      try {
        probed = await deps.probe.probe(deps.storage.resolvePath(key));
      } catch (error) {
        throw new DomainError("INVALID_MEDIA", `Cannot read audio file: ${(error as Error).message}`);
      }
      if (probed.kind !== "audio") {
        throw new DomainError("INVALID_MEDIA", `${fileName} contains ${probed.kind}, expected audio`);
      }
      const item: LibrarySfx = {
        id,
        name: sfxNameFromFileName(fileName),
        fileName,
        path,
        contentHash: `sha256:${written.sha256}`,
        createdAt: deps.clock.now(),
      };
      if (probed.durationMs !== undefined) item.durationMs = probed.durationMs;
      return await deps.library.add(item);
    } catch (error) {
      await deps.storage.remove(key);
      throw error;
    }
  };
}

export function makeListLibrarySfx(deps: { library: SfxLibraryRepository }) {
  return () => deps.library.list();
}

export function makeRenameLibrarySfx(deps: { library: SfxLibraryRepository }) {
  return (input: { id: string; name: string }) => deps.library.rename(input.id, input.name);
}

/** Removes the effect from the library only; projects keep their own copy of the file. */
export function makeRemoveLibrarySfx(deps: { library: SfxLibraryRepository; storage: StoragePort }) {
  return async (id: string): Promise<void> => {
    const item = await deps.library.get(id);
    await deps.library.remove(id);
    await deps.storage.remove(libraryKey(item));
  };
}

async function* nothing(): AsyncIterable<Uint8Array> {}

/** Streams a library file for listening in the browser, with HTTP Range support. */
export function makeReadLibrarySfxFile(deps: { library: SfxLibraryRepository; storage: StoragePort }) {
  return async (input: { id: string; range?: string | null }): Promise<ReadProjectFileResult> => {
    const item = await deps.library.get(input.id);
    const key = libraryKey(item);
    const info = await deps.storage.stat(key).catch(() => null);
    if (!info) throw new DomainError("FILE_NOT_FOUND", "File not found");
    const range = parseByteRange(input.range, info.size);
    if (range === "invalid") return { status: 416, size: info.size };
    const { start, end } = range ?? { start: 0, end: info.size - 1 };
    return {
      status: range ? 206 : 200,
      contentType: contentTypeForFileName(item.fileName),
      immutable: true,
      size: info.size,
      start,
      end,
      body: info.size === 0 ? nothing() : deps.storage.read(key, { start, end }),
    };
  };
}

export interface UseLibrarySfxDeps {
  library: SfxLibraryRepository;
  repo: ProjectRepository;
  storage: StoragePort;
  clock: Clock;
  newId?: IdGenerator;
}

/**
 * Makes a library effect available to a project as an ordinary audio asset by copying the file into the
 * project folder, so render, preview and export never read outside the project. The same file picked
 * twice is copied once.
 */
export function makeUseLibrarySfxInProject(deps: UseLibrarySfxDeps) {
  const sameFile = (project: Project, item: LibrarySfx) =>
    project.assets.find((asset) => asset.kind === "audio" && asset.contentHash === item.contentHash);

  return async (input: {
    projectId: string;
    sfxId: string;
  }): Promise<{ project: Project; asset: MediaAsset }> => {
    const item = await deps.library.get(input.sfxId);
    const current = await deps.repo.get(input.projectId);
    const existing = sameFile(current, item);
    if (existing) return { project: current, asset: existing };

    const assetId = (deps.newId ?? newId)("ast");
    const path = `media/${assetId}.${fileExtension(item.fileName) ?? "mp3"}`;
    const key = `projects/${input.projectId}/${path}`;
    try {
      await deps.storage.write(key, deps.storage.read(libraryKey(item)));
      const asset: MediaAsset = {
        id: assetId,
        kind: "audio",
        source: "library",
        fileName: item.fileName,
        path,
        contentHash: item.contentHash,
        createdAt: deps.clock.now(),
      };
      if (item.durationMs !== undefined) asset.durationMs = item.durationMs;

      let result: { project: Project; asset: MediaAsset } = { project: current, asset };
      const project = await deps.repo.update(input.projectId, (stored) => {
        // A concurrent request may have copied the same effect while this one was writing.
        const raced = sameFile(stored, item);
        if (raced) {
          result = { project: stored, asset: raced };
          return stored;
        }
        return { ...addAsset(stored, asset), updatedAt: deps.clock.now() };
      });
      if (result.asset !== asset) {
        await deps.storage.remove(key);
        return { project, asset: result.asset };
      }
      return { project, asset };
    } catch (error) {
      await deps.storage.remove(key);
      throw error;
    }
  };
}
