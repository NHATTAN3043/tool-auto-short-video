import {
  ownTwinFilters,
  rankCandidates,
  searchLibraryMatches,
  searchProjectAssets,
  tagsFromFileName,
  watermarkAssetId,
  type ClipShot,
  type LibraryMatch,
  type LibraryMedia,
  type MediaAsset,
  type MediaCandidate,
  type MediaSearchQuery,
  type StockProvider,
} from "@studio/domain";

import type { MediaLibraryRepository } from "../ports/media-library";
import type { MediaSearchPort } from "../ports/media-search";
import type { ProjectRepository } from "../ports/project-repository";

export const PROJECT_RESULTS = 12;
export const LIBRARY_RESULTS = 12;
export const STOCK_RESULTS_PER_PROVIDER = 15;
/** Best shots offered from one analyzed clip, so one long clip cannot take every library place. */
export const SHOTS_PER_CLIP = 3;

export interface MediaSearchDeps {
  repo: ProjectRepository;
  library: MediaLibraryRepository;
  /** Only the providers that have an API key. */
  providers: readonly MediaSearchPort[];
}

export interface MediaSearchResult {
  candidates: MediaCandidate[];
  /** A provider that failed does not fail the whole search. */
  errors: { provider: StockProvider; message: string }[];
  /** Stock providers this project may search (key present and the mediaSearch toggle on). */
  stockProviders: StockProvider[];
}

export function libraryCandidate(item: LibraryMedia): MediaCandidate {
  const candidate: MediaCandidate = {
    provider: "library",
    ref: item.id,
    kind: item.kind,
    width: item.width ?? 1080,
    height: item.height ?? 1920,
    thumbnail: { type: "library", id: item.id, file: item.thumbnailPath ? "thumbnail" : "media" },
    preview: { type: "library", id: item.id, file: "media" },
  };
  if (item.durationMs !== undefined) candidate.durationMs = item.durationMs;
  if (item.tags.length > 0) candidate.description = item.tags.join(", ").slice(0, 500);
  return candidate;
}

/**
 * One shot of an analyzed library video (ADR 0019): its still, its length and its description. Picking it
 * starts the scene at the shot's start.
 */
export function shotCandidate(item: LibraryMedia, shot: ClipShot): MediaCandidate {
  const candidate: MediaCandidate = {
    provider: "library",
    ref: item.id,
    kind: "video",
    width: item.width ?? 1080,
    height: item.height ?? 1920,
    durationMs: shot.endMs - shot.startMs,
    thumbnail: { type: "library", id: item.id, file: "shot", shot: shot.index },
    preview: { type: "library", id: item.id, file: "media" },
    segment: { index: shot.index, startMs: shot.startMs, endMs: shot.endMs },
  };
  const description = [shot.description, shot.tags.join(", ")].filter((part) => part !== "").join(" · ");
  if (description !== "") candidate.description = description.slice(0, 500);
  if (shot.textOverlay) candidate.textOverlay = true;
  return candidate;
}

/** Library matches as candidates: at most SHOTS_PER_CLIP shots of each clip, the best ones. */
function libraryCandidates(matches: readonly LibraryMatch[], limit: number): MediaCandidate[] {
  const shotsTaken = new Map<string, number>();
  const result: MediaCandidate[] = [];
  for (const match of matches) {
    if (result.length >= limit) break;
    if (!match.shot) {
      result.push(libraryCandidate(match.item));
      continue;
    }
    const taken = shotsTaken.get(match.item.id) ?? 0;
    if (taken >= SHOTS_PER_CLIP) continue;
    shotsTaken.set(match.item.id, taken + 1);
    result.push(shotCandidate(match.item, match.shot));
  }
  return result;
}

/** A file the user uploaded to this project, offered by the tags in its name. */
export function projectCandidate(projectId: string, asset: MediaAsset): MediaCandidate {
  const kind = asset.kind === "image" ? "image" : "video";
  const candidate: MediaCandidate = {
    provider: "project",
    ref: asset.id,
    kind,
    width: asset.width ?? 1080,
    height: asset.height ?? 1920,
    thumbnail: { type: "project", projectId, assetId: asset.id, path: asset.thumbnailPath ?? asset.path },
    preview: { type: "project", projectId, assetId: asset.id, path: asset.path },
  };
  if (asset.durationMs !== undefined) candidate.durationMs = asset.durationMs;
  const tags = tagsFromFileName(asset.fileName);
  if (tags.length > 0) candidate.description = tags.join(", ").slice(0, 500);
  return candidate;
}

/** Stock providers usable for a project: free stock search follows the `mediaSearch` toggle. */
export function allowedProviders(
  providers: readonly MediaSearchPort[],
  mediaSearch: boolean,
): readonly MediaSearchPort[] {
  return mediaSearch ? providers : [];
}

/**
 * The project's own uploads first (matched by the tags in their file names), then the library (free,
 * already downloaded), then the stock providers in parallel. Uploads and the library are always searched,
 * also in Manual mode.
 */
export function makeSearchMedia(deps: MediaSearchDeps) {
  return async (input: { projectId: string; query: MediaSearchQuery }): Promise<MediaSearchResult> => {
    const project = await deps.repo.get(input.projectId);
    const { query } = input;
    const providers = allowedProviders(deps.providers, project.automationSettings.mediaSearch).filter(
      (provider) => query.sources.includes(provider.id),
    );
    const items = await deps.library.list();
    // A file in both the project and the library is offered once.
    const twins = ownTwinFilters(project.assets, items);
    // The channel logo is an image upload too, but never a scene's picture.
    const logoId = watermarkAssetId(project);
    const own = query.sources.includes("project")
      ? searchProjectAssets(
          project.assets.filter((asset) => asset.id !== logoId && twins.keepAsset(asset)),
          query.query,
          query.kind,
        )
          .slice(0, PROJECT_RESULTS)
          .map((asset) => projectCandidate(project.id, asset))
      : [];
    const library = query.sources.includes("library")
      ? libraryCandidates(
          searchLibraryMatches(items.filter(twins.keepItem), query.query, query.kind),
          LIBRARY_RESULTS,
        )
      : [];

    const bySourceRef = new Map(items.map((item) => [item.sourceRef, item.id]));
    const errors: MediaSearchResult["errors"] = [];
    const stock = await Promise.all(
      providers.map(async (provider) => {
        try {
          const found = await provider.search({
            query: query.query,
            kind: query.kind,
            lang: query.lang,
            perPage: STOCK_RESULTS_PER_PROVIDER,
          });
          return found.map((candidate) => {
            const libraryId = bySourceRef.get(`${provider.id}:${candidate.kind}:${candidate.ref}`);
            return libraryId === undefined ? candidate : { ...candidate, libraryId };
          });
        } catch (error) {
          errors.push({
            provider: provider.id,
            message: error instanceof Error ? error.message : String(error),
          });
          return [];
        }
      }),
    );
    return {
      candidates: rankCandidates([...own, ...library], stock),
      errors,
      stockProviders: allowedProviders(deps.providers, project.automationSettings.mediaSearch).map(
        (p) => p.id,
      ),
    };
  };
}
