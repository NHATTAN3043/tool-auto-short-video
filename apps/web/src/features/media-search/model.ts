import {
  narrationKeywords,
  type ContentLanguage,
  type LibrarySource,
  type MediaCandidate,
  type MediaLink,
  type MediaSourceFilter,
  type PickedCandidate,
  type SearchLanguage,
  type VisualPlan,
} from "@studio/domain";

// Pure rules of the media search panel: where files are loaded from, which keywords to offer.

export const LANGUAGE_LABELS: Record<SearchLanguage, string> = {
  en: "English",
  vi: "Tiếng Việt",
  zh: "中文",
};

export const SOURCE_LABELS: Record<MediaSourceFilter, string> = {
  project: "File của dự án",
  library: "Thư viện chung",
  pexels: "Pexels",
  pixabay: "Pixabay",
};

/** Where an item of the shared library came from. */
export const LIBRARY_SOURCE_LABELS: Record<LibrarySource, string> = {
  pexels: "Pexels",
  pixabay: "Pixabay",
  upload: "Tự tải",
};

/** What the server needs to import a candidate: never a URL; a shot is named by its number only. */
export function pickedCandidate(candidate: MediaCandidate): PickedCandidate {
  return {
    provider: candidate.provider,
    ref: candidate.ref,
    kind: candidate.kind,
    ...(candidate.segment && { segmentIndex: candidate.segment.index }),
  };
}

/** The preview to play: a shot of a clip plays only its own stretch (a media fragment). */
export function previewUrl(candidate: MediaCandidate): string {
  const url = linkUrl(candidate.preview ?? candidate.thumbnail);
  const segment = candidate.segment;
  return segment ? `${url}#t=${String(segment.startMs / 1000)},${String(segment.endMs / 1000)}` : url;
}

/** `Đoạn 4 · 0:12` for a shot of a clip, nothing for a whole file. */
export function segmentLabel(candidate: MediaCandidate): string | null {
  const segment = candidate.segment;
  if (!segment) return null;
  const seconds = Math.floor(segment.startMs / 1000);
  return `Đoạn ${String(segment.index + 1)} · ${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Every source, own files first: what "Tất cả nguồn" searches. */
export const ALL_SOURCES: MediaSourceFilter[] = ["project", "library", "pexels", "pixabay"];

/** Browser URL of a candidate file: stock files go through the server proxy, never straight to the CDN. */
export function linkUrl(link: MediaLink): string {
  if (link.type === "remote") return `/api/media-proxy?url=${encodeURIComponent(link.url)}`;
  if (link.type === "project") {
    const path = link.path.split("/").map(encodeURIComponent).join("/");
    return `/api/projects/${encodeURIComponent(link.projectId)}/files/${path}`;
  }
  const shot = link.file === "shot" ? `&shot=${String(link.shot ?? 0)}` : "";
  return `/api/media-library/${encodeURIComponent(link.id)}/file?file=${link.file}${shot}`;
}

export function libraryFileUrl(id: string, file: "media" | "thumbnail"): string {
  return linkUrl({ type: "library", id, file });
}

/** The still of one shot of an analyzed library video (ADR 0019). */
export function shotFileUrl(id: string, shot: number): string {
  return linkUrl({ type: "library", id, file: "shot", shot });
}

export interface KeywordGroup {
  lang: SearchLanguage;
  queries: string[];
  /** Shown instead of the language name. */
  label?: string;
}

/**
 * Free keywords cut from the narration, for a scene without AI keywords: works in every mode, without any
 * key. Null when the narration has nothing to search with.
 */
export function narrationKeywordGroup(narration: string, language: ContentLanguage): KeywordGroup | null {
  const queries = narrationKeywords(narration, language);
  return queries.length === 0 ? null : { lang: language, queries, label: "Từ lời đọc" };
}

/** The scene's keywords per language, English first; empty languages are left out. */
export function keywordGroups(plan: VisualPlan | undefined): KeywordGroup[] {
  if (!plan) return [];
  const groups: KeywordGroup[] = [
    { lang: "en", queries: queriesFor(plan, "en") },
    { lang: "vi", queries: queriesFor(plan, "vi") },
    { lang: "zh", queries: queriesFor(plan, "zh") },
  ];
  return groups.filter((group) => group.queries.length > 0);
}

/** The scene's keywords in one language. */
export function queriesFor(plan: VisualPlan | undefined, lang: SearchLanguage): string[] {
  if (!plan) return [];
  return lang === "en" ? plan.searchQueries : (plan.localizedQueries?.[lang] ?? []);
}

/**
 * Query after the user switches the search language: the scene's first keyword in that language, or
 * the current query when the scene has none in it.
 */
export function queryForLanguage(
  plan: VisualPlan | undefined,
  lang: SearchLanguage,
  current: string,
): string {
  return queriesFor(plan, lang)[0] ?? current;
}

/** First keyword to prefill the search with: English, else any language, else the narration's. */
export function initialSearch(
  plan: VisualPlan | undefined,
  fallback: KeywordGroup | null = null,
): { query: string; lang: SearchLanguage } {
  const first = keywordGroups(plan)[0] ?? fallback ?? undefined;
  return { query: first?.queries[0] ?? "", lang: first?.lang ?? "en" };
}

/** `0:08` */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

export function orientationLabel(width: number, height: number): string {
  if (height > width) return "Dọc";
  return height === width ? "Vuông" : "Ngang";
}

/** "a, b , ,c" → ["a", "b", "c"] */
export function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}
