import {
  addAsset,
  DomainError,
  fileExtension,
  mediaKindFromFileName,
  newId,
  type IdGenerator,
  type MediaAsset,
  type MediaSource,
  type Project,
} from "@studio/domain";

import type { Clock } from "../ports/clock";
import type { MediaProbePort, ProbeResult } from "../ports/media-probe";
import type { ProjectRepository } from "../ports/project-repository";
import type { StoragePort } from "../ports/storage";
import { displayName, limited } from "./upload-stream";

export interface ImportAssetInput {
  projectId: string;
  /** Original name from the user; only used for display and to pick the file type. */
  fileName: string;
  data: AsyncIterable<Uint8Array>;
  source?: MediaSource;
}

export interface ImportAssetDeps {
  repo: ProjectRepository;
  storage: StoragePort;
  probe: MediaProbePort;
  clock: Clock;
  newId?: IdGenerator;
  /** Upload size limit; the write stops and is cleaned up as soon as the stream goes past it. */
  maxBytes?: number;
}

export const THUMBNAIL_WIDTH = 360;

function assetFromProbe(base: Omit<MediaAsset, "kind">, probed: ProbeResult): MediaAsset {
  const asset: MediaAsset = { ...base, kind: probed.kind };
  if (probed.kind !== "image" && probed.durationMs !== undefined) asset.durationMs = probed.durationMs;
  if (probed.kind !== "audio") {
    if (probed.width !== undefined) asset.width = probed.width;
    if (probed.height !== undefined) asset.height = probed.height;
  }
  if (probed.kind === "video") {
    if (probed.fps !== undefined) asset.fps = probed.fps;
    asset.hasAudio = probed.hasAudio;
  }
  return asset;
}

/**
 * Stores an uploaded file untouched, probes it, makes a thumbnail and adds it to the project.
 * Every failure after the file is written removes what was written.
 */
export function makeImportAsset(deps: ImportAssetDeps) {
  return async (input: ImportAssetInput): Promise<{ project: Project; asset: MediaAsset }> => {
    const fileName = displayName(input.fileName);
    const expectedKind = mediaKindFromFileName(fileName);
    const extension = fileExtension(fileName);
    if (expectedKind === null || extension === null) {
      throw new DomainError("INVALID_MEDIA", `Unsupported file type: ${fileName}`);
    }
    await deps.repo.get(input.projectId);

    const assetId = (deps.newId ?? newId)("ast");
    const projectKey = `projects/${input.projectId}`;
    const mediaPath = `media/${assetId}.${extension}`;
    const thumbnailPath = `thumbnails/${assetId}.jpg`;
    const mediaKey = `${projectKey}/${mediaPath}`;
    const thumbnailKey = `${projectKey}/${thumbnailPath}`;
    const cleanup = () => Promise.all([deps.storage.remove(mediaKey), deps.storage.remove(thumbnailKey)]);

    try {
      const written = await deps.storage.write(
        mediaKey,
        deps.maxBytes === undefined ? input.data : limited(input.data, deps.maxBytes),
      );
      if (written.bytes === 0) throw new DomainError("INVALID_MEDIA", "The file is empty");

      let probed: ProbeResult;
      try {
        probed = await deps.probe.probe(deps.storage.resolvePath(mediaKey));
      } catch (error) {
        throw new DomainError("INVALID_MEDIA", `Cannot read media file: ${(error as Error).message}`);
      }
      if (probed.kind !== expectedKind) {
        throw new DomainError(
          "INVALID_MEDIA",
          `${fileName} contains ${probed.kind}, expected ${expectedKind}`,
        );
      }

      const base: Omit<MediaAsset, "kind"> = {
        id: assetId,
        source: input.source ?? "upload",
        fileName,
        path: mediaPath,
        contentHash: `sha256:${written.sha256}`,
        createdAt: deps.clock.now(),
      };
      if (probed.kind !== "audio") {
        // A thumbnail is a convenience; a file ffmpeg cannot thumbnail is still usable.
        try {
          const atMs = probed.kind === "video" ? Math.min(1000, Math.floor((probed.durationMs ?? 0) / 2)) : 0;
          await deps.probe.createThumbnail(
            deps.storage.resolvePath(mediaKey),
            await deps.storage.pathForWrite(thumbnailKey),
            { atMs, width: THUMBNAIL_WIDTH },
          );
          if (await deps.storage.exists(thumbnailKey)) base.thumbnailPath = thumbnailPath;
        } catch {
          await deps.storage.remove(thumbnailKey);
        }
      }

      const asset = assetFromProbe(base, probed);
      const project = await deps.repo.update(input.projectId, (stored) => ({
        ...addAsset(stored, asset),
        updatedAt: deps.clock.now(),
      }));
      return { project, asset };
    } catch (error) {
      await cleanup();
      throw error;
    }
  };
}
