import type { MediaLink, MediaSourceFilter, SearchLanguage, VisualPlan } from "@studio/domain";

// Pure rules of the media search panel: where files are loaded from, which keywords to offer.

export const LANGUAGE_LABELS: Record<SearchLanguage, string> = {
  en: "English",
  vi: "Tiếng Việt",
  zh: "中文",
};

export const SOURCE_LABELS: Record<MediaSourceFilter, string> = {
  library: "Thư viện chung",
  pexels: "Pexels",
  pixabay: "Pixabay",
};

/** Browser URL of a candidate file: stock files go through the server proxy, never straight to the CDN. */
export function linkUrl(link: MediaLink): string {
  if (link.type === "remote") return `/api/media-proxy?url=${encodeURIComponent(link.url)}`;
  return `/api/media-library/${encodeURIComponent(link.id)}/file?file=${link.file}`;
}

export function libraryFileUrl(id: string, file: "media" | "thumbnail"): string {
  return linkUrl({ type: "library", id, file });
}

export interface KeywordGroup {
  lang: SearchLanguage;
  queries: string[];
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

/** First keyword to prefill the search with: English, else any language. */
export function initialSearch(plan: VisualPlan | undefined): { query: string; lang: SearchLanguage } {
  const first = keywordGroups(plan)[0];
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
