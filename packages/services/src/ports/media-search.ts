import type { MediaCandidate, SearchLanguage, StockProvider } from "@studio/domain";

export interface StockSearch {
  query: string;
  kind: "video" | "image";
  lang: SearchLanguage;
  perPage: number;
}

/** The file to download for a picked stock candidate. */
export interface StockFile {
  url: string;
  /** Without dot: "mp4", "jpg"… */
  extension: string;
}

/** A free stock media provider (Pexels, Pixabay). Only the server calls it; keys never reach the browser. */
export interface MediaSearchPort {
  readonly id: StockProvider;
  /** Candidates with `provider` = this id and remote thumbnail/preview links. */
  search(query: StockSearch): Promise<MediaCandidate[]>;
  /** Looks the item up again by its id, so the browser never chooses a URL to download. */
  resolve(kind: "video" | "image", ref: string): Promise<StockFile>;
  /** Hosts of this provider's thumbnails and previews, which the server may proxy for the browser. */
  isProxyUrl(url: URL): boolean;
}
