import {
  addAsset,
  DomainError,
  newId,
  normalizeTags,
  stockSourceRef,
  type IdGenerator,
  type LibraryMedia,
  type MediaAsset,
  type PickedCandidate,
  type Project,
  type StockProvider,
} from "@studio/domain";

import { limited } from "../media/upload-stream";
import type { Clock } from "../ports/clock";
import type { MediaLibraryRepository } from "../ports/media-library";
import type { MediaProbePort } from "../ports/media-probe";
import type { MediaSearchPort } from "../ports/media-search";
import type { ProjectRepository } from "../ports/project-repository";
import type { RemoteFilePort } from "../ports/remote-files";
import type { StoragePort } from "../ports/storage";
import { KeyedLock } from "../shared/keyed-lock";
import { allowedProviders } from "./search-media";

/** Storage folder of the shared media library; `LibraryMedia.path` is relative to it. */
export const MEDIA_LIBRARY_ROOT = "library/media";
const THUMBNAIL_WIDTH = 360;

export const libraryMediaKey = (relative: string) => `${MEDIA_LIBRARY_ROOT}/${relative}`;

export interface ImportCandidateDeps {
  repo: ProjectRepository;
  library: MediaLibraryRepository;
  providers: readonly MediaSearchPort[];
  storage: StoragePort;
  probe: MediaProbePort;
  remote: RemoteFilePort;
  clock: Clock;
  newId?: IdGenerator;
  /** Largest file accepted from a provider. */
  maxBytes?: number;
}

export interface ImportCandidateInput {
  projectId: string;
  candidate: PickedCandidate;
  /** The search that found it; becomes the library item's first tag. */
  query: string;
}

export interface ImportCandidateResult {
  project: Project;
  asset: MediaAsset;
  /** Where the scene should start in the video: the start of the picked shot of an analyzed clip. */
  startMs?: number;
}

const extensionOf = (path: string) => path.split(".").at(-1) ?? "bin";

/**
 * Makes a picked candidate a project asset. A stock file is downloaded once into the shared library
 * (tagged with the search), then copied into the project like a library item, so the project folder
 * stays self-contained. The same file picked twice for a project is copied once.
 */
export function makeImportCandidate(deps: ImportCandidateDeps) {
  const downloads = new KeyedLock();
  const id = (prefix: "ast" | "lib") => (deps.newId ?? newId)(prefix);

  async function downloadToLibrary(
    provider: MediaSearchPort,
    candidate: PickedCandidate,
    query: string,
  ): Promise<LibraryMedia> {
    const sourceRef = stockSourceRef(provider.id, candidate.kind, candidate.ref);
    // Two scenes picking the same clip at once must not download it twice.
    return downloads.run(sourceRef, async () => {
      const existing = await deps.library.findBySourceRef(sourceRef);
      if (existing) return existing;

      let file;
      try {
        file = await provider.resolve(candidate.kind, candidate.ref);
      } catch (error) {
        throw new DomainError("MEDIA_SEARCH_FAILED", `Cannot find ${sourceRef}: ${(error as Error).message}`);
      }
      const libraryId = id("lib");
      const path = `files/${libraryId}.${file.extension}`;
      const thumbnailPath = `thumbnails/${libraryId}.jpg`;
      const key = libraryMediaKey(path);
      const thumbnailKey = libraryMediaKey(thumbnailPath);
      try {
        let written;
        try {
          const remote = await deps.remote.open(file.url);
          written = await deps.storage.write(
            key,
            deps.maxBytes === undefined ? remote.body : limited(remote.body, deps.maxBytes),
          );
        } catch (error) {
          if (error instanceof DomainError) throw error;
          throw new DomainError("MEDIA_SEARCH_FAILED", `Download failed: ${(error as Error).message}`);
        }
        const probed = await deps.probe.probe(deps.storage.resolvePath(key)).catch((error: unknown) => {
          throw new DomainError("INVALID_MEDIA", `Cannot read downloaded file: ${(error as Error).message}`);
        });
        if (probed.kind !== candidate.kind) {
          throw new DomainError("INVALID_MEDIA", `Downloaded ${probed.kind}, expected ${candidate.kind}`);
        }
        const item: LibraryMedia = {
          id: libraryId,
          kind: candidate.kind,
          fileName: `${provider.id}-${candidate.ref}.${file.extension}`,
          path,
          tags: normalizeTags([query]),
          usageCount: 0,
          source: provider.id,
          sourceRef,
          contentHash: `sha256:${written.sha256}`,
          createdAt: deps.clock.now(),
        };
        if (probed.durationMs !== undefined && candidate.kind === "video")
          item.durationMs = probed.durationMs;
        if (probed.width !== undefined) item.width = probed.width;
        if (probed.height !== undefined) item.height = probed.height;
        if (candidate.kind === "video") item.hasAudio = probed.hasAudio;
        try {
          const atMs =
            candidate.kind === "video" ? Math.min(1000, Math.floor((probed.durationMs ?? 0) / 2)) : 0;
          await deps.probe.createThumbnail(
            deps.storage.resolvePath(key),
            await deps.storage.pathForWrite(thumbnailKey),
            { atMs, width: THUMBNAIL_WIDTH },
          );
          if (await deps.storage.exists(thumbnailKey)) item.thumbnailPath = thumbnailPath;
        } catch {
          await deps.storage.remove(thumbnailKey);
        }
        return await deps.library.add(item);
      } catch (error) {
        await Promise.all([deps.storage.remove(key), deps.storage.remove(thumbnailKey)]);
        throw error;
      }
    });
  }

  async function copyToProject(projectId: string, item: LibraryMedia) {
    const current = await deps.repo.get(projectId);
    const same = current.assets.find((asset) => asset.contentHash === item.contentHash);
    if (same) return { project: current, asset: same };

    const assetId = id("ast");
    const path = `media/${assetId}.${extensionOf(item.path)}`;
    const thumbnailPath = `thumbnails/${assetId}.jpg`;
    const key = `projects/${projectId}/${path}`;
    const thumbnailKey = `projects/${projectId}/${thumbnailPath}`;
    try {
      await deps.storage.write(key, deps.storage.read(libraryMediaKey(item.path)));
      const asset: MediaAsset = {
        id: assetId,
        kind: item.kind,
        source: item.source,
        fileName: item.fileName,
        path,
        contentHash: item.contentHash,
        createdAt: deps.clock.now(),
      };
      if (item.thumbnailPath) {
        await deps.storage.write(thumbnailKey, deps.storage.read(libraryMediaKey(item.thumbnailPath)));
        asset.thumbnailPath = thumbnailPath;
      }
      if (item.durationMs !== undefined) asset.durationMs = item.durationMs;
      if (item.width !== undefined) asset.width = item.width;
      if (item.height !== undefined) asset.height = item.height;
      if (item.hasAudio !== undefined) asset.hasAudio = item.hasAudio;

      let result: { project: Project; asset: MediaAsset } = { project: current, asset };
      await deps.repo.update(projectId, (stored) => {
        // A concurrent pick of the same file may have copied it while this one was writing.
        const raced = stored.assets.find((existing) => existing.contentHash === item.contentHash);
        if (raced) {
          result = { project: stored, asset: raced };
          return stored;
        }
        const project = { ...addAsset(stored, asset), updatedAt: deps.clock.now() };
        result = { project, asset };
        return project;
      });
      if (result.asset !== asset) {
        await Promise.all([deps.storage.remove(key), deps.storage.remove(thumbnailKey)]);
      } else {
        await deps.library.incrementUsage(item.id);
      }
      return result;
    } catch (error) {
      await Promise.all([deps.storage.remove(key), deps.storage.remove(thumbnailKey)]);
      throw error;
    }
  }

  return async (input: ImportCandidateInput): Promise<ImportCandidateResult> => {
    const { candidate } = input;
    if (candidate.provider === "project") {
      // Already the project's own file: nothing to download or copy.
      const project = await deps.repo.get(input.projectId);
      const asset = project.assets.find((existing) => existing.id === candidate.ref);
      if (!asset) throw new DomainError("ASSET_NOT_FOUND", `Asset ${candidate.ref} not found`);
      return { project, asset };
    }
    if (candidate.provider === "library") {
      const item = await deps.library.get(candidate.ref);
      if (candidate.segmentIndex === undefined) return copyToProject(input.projectId, item);
      // The shot's times come from the library, never from the request (ADR 0019).
      const shot = item.analysis?.shots[candidate.segmentIndex];
      if (!shot)
        throw new DomainError(
          "INVALID_MEDIA",
          `Đoạn ${String(candidate.segmentIndex)} không còn trong video`,
        );
      return { ...(await copyToProject(input.projectId, item)), startMs: shot.startMs };
    }
    const project = await deps.repo.get(input.projectId);
    const providerId: StockProvider = candidate.provider;
    const provider = allowedProviders(deps.providers, project.automationSettings.mediaSearch).find(
      (candidateProvider) => candidateProvider.id === providerId,
    );
    if (!provider) {
      throw new DomainError("INVALID_OPERATION", `Stock search with ${providerId} is not available here`);
    }
    const item = await downloadToLibrary(provider, candidate, input.query);
    return copyToProject(input.projectId, item);
  };
}
