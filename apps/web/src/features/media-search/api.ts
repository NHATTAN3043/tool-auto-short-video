import {
  LibraryMediaSchema,
  MediaAssetSchema,
  MediaCandidateSchema,
  type LibraryMedia,
  type MediaAsset,
  type MediaSearchQuery,
  type PickedCandidate,
} from "@studio/domain";
import { z } from "zod";

import { request } from "@/features/project/api";

export const MediaSearchResultSchema = z.object({
  candidates: z.array(MediaCandidateSchema),
  errors: z.array(z.object({ provider: z.string(), message: z.string() })),
  stockProviders: z.array(z.string()),
});
export type MediaSearchResult = z.infer<typeof MediaSearchResultSchema>;

export function searchMedia(projectId: string, query: MediaSearchQuery): Promise<MediaSearchResult> {
  const params = new URLSearchParams({
    q: query.query,
    kind: query.kind,
    lang: query.lang,
    sources: query.sources.join(","),
  });
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/media-search?${params.toString()}`,
    { method: "GET" },
    MediaSearchResultSchema,
  );
}

export async function importCandidate(
  projectId: string,
  candidate: PickedCandidate,
  query: string,
): Promise<MediaAsset> {
  const { asset } = await request(
    `/api/projects/${encodeURIComponent(projectId)}/media-search/import`,
    { method: "POST", body: JSON.stringify({ candidate, query }) },
    z.object({ asset: MediaAssetSchema }),
  );
  return asset;
}

export function listLibraryMedia(): Promise<LibraryMedia[]> {
  return request("/api/media-library", { method: "GET" }, z.array(LibraryMediaSchema));
}

export function setLibraryMediaTags(id: string, tags: readonly string[]): Promise<LibraryMedia> {
  return request(
    `/api/media-library/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ tags }) },
    LibraryMediaSchema,
  );
}

export async function removeLibraryMedia(id: string): Promise<void> {
  const res = await fetch(`/api/media-library/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Không xoá được media khỏi thư viện chung.");
}
