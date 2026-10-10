import {
  rankCandidates,
  searchLibrary,
  type LibraryMedia,
  type MediaCandidate,
  type MediaSearchQuery,
  type StockProvider,
} from "@studio/domain";

import type { MediaLibraryRepository } from "../ports/media-library";
import type { MediaSearchPort } from "../ports/media-search";
import type { ProjectRepository } from "../ports/project-repository";

export const LIBRARY_RESULTS = 12;
export const STOCK_RESULTS_PER_PROVIDER = 15;

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

/** Stock providers usable for a project: free stock search follows the `mediaSearch` toggle. */
export function allowedProviders(
  providers: readonly MediaSearchPort[],
  mediaSearch: boolean,
): readonly MediaSearchPort[] {
  return mediaSearch ? providers : [];
}

/**
 * Library first (free, already downloaded), then the stock providers in parallel. The library is
 * always searched, also in Manual mode.
 */
export function makeSearchMedia(deps: MediaSearchDeps) {
  return async (input: { projectId: string; query: MediaSearchQuery }): Promise<MediaSearchResult> => {
    const project = await deps.repo.get(input.projectId);
    const { query } = input;
    const providers = allowedProviders(deps.providers, project.automationSettings.mediaSearch).filter(
      (provider) => query.sources.includes(provider.id),
    );
    const items = await deps.library.list();
    const library = query.sources.includes("library")
      ? searchLibrary(items, query.query, query.kind).slice(0, LIBRARY_RESULTS).map(libraryCandidate)
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
      candidates: rankCandidates(library, stock),
      errors,
      stockProviders: allowedProviders(deps.providers, project.automationSettings.mediaSearch).map(
        (p) => p.id,
      ),
    };
  };
}
