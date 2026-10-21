"use client";

import type {
  MediaAsset,
  MediaCandidate,
  MediaSourceFilter,
  SearchLanguage,
  VisualPlan,
} from "@studio/domain";
import { useCallback, useState } from "react";

import { importCandidate, searchMedia, type MediaSearchResult } from "../api";
import { ALL_SOURCES, initialSearch, queryForLanguage, type KeywordGroup } from "../model";

const message = (error: unknown) => (error instanceof Error ? error.message : "Đã có lỗi xảy ra.");

export type SourceChoice = "all" | MediaSourceFilter;

/** Search state of one scene: query, filters, results, and picking a candidate. */
export function useMediaSearch(
  projectId: string,
  plan: VisualPlan | undefined,
  onPicked: (asset: MediaAsset) => void,
  /** Keywords from the narration, used when the scene has no AI keywords. */
  fallback: KeywordGroup | null = null,
) {
  const initial = initialSearch(plan, fallback);
  const [query, setQuery] = useState(initial.query);
  const [lang, setLang] = useState<SearchLanguage>(initial.lang);
  const [kind, setKind] = useState<"video" | "image">(plan?.preferredMedia ?? "video");
  const [source, setSource] = useState<SourceChoice>("all");
  const [result, setResult] = useState<MediaSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (next?: { query?: string; lang?: SearchLanguage }) => {
      const q = (next?.query ?? query).trim();
      const l = next?.lang ?? lang;
      if (next?.query !== undefined) setQuery(next.query);
      if (next?.lang !== undefined) setLang(next.lang);
      if (q === "") return;
      setSearching(true);
      setError(null);
      try {
        setResult(
          await searchMedia(projectId, {
            query: q,
            kind,
            lang: l,
            sources: source === "all" ? ALL_SOURCES : [source],
          }),
        );
      } catch (cause) {
        setError(message(cause));
      } finally {
        setSearching(false);
      }
    },
    [projectId, query, lang, kind, source],
  );

  /** Another language: search with the scene's keyword in it (English is the default on open). */
  const switchLang = useCallback(
    (next: SearchLanguage) => {
      const nextQuery = queryForLanguage(plan, next, query);
      if (nextQuery === query) {
        setLang(next);
        return;
      }
      void run({ query: nextQuery, lang: next });
    },
    [plan, query, run],
  );

  const pick = useCallback(
    async (candidate: MediaCandidate) => {
      setPicking(`${candidate.provider}:${candidate.ref}`);
      setError(null);
      try {
        const asset = await importCandidate(
          projectId,
          { provider: candidate.provider, ref: candidate.ref, kind: candidate.kind },
          query.trim(),
        );
        onPicked(asset);
      } catch (cause) {
        setError(message(cause));
      } finally {
        setPicking(null);
      }
    },
    [projectId, query, onPicked],
  );

  return {
    query,
    setQuery,
    lang,
    setLang,
    switchLang,
    kind,
    setKind,
    source,
    setSource,
    result,
    searching,
    picking,
    error,
    run,
    pick,
  };
}

export type MediaSearchState = ReturnType<typeof useMediaSearch>;
