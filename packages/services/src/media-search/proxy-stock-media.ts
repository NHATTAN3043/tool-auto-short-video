import { DomainError } from "@studio/domain";

import type { MediaSearchPort } from "../ports/media-search";
import type { RemoteFile, RemoteFilePort } from "../ports/remote-files";

/**
 * Streams a stock thumbnail or preview to the browser, so the browser never talks to the providers.
 * Only HTTPS URLs on the configured providers' media hosts are fetched; anything else is "not found".
 */
export function makeProxyStockMedia(deps: { providers: readonly MediaSearchPort[]; remote: RemoteFilePort }) {
  return async (input: { url: string; range?: string | null }): Promise<RemoteFile> => {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new DomainError("FILE_NOT_FOUND", "Invalid media URL");
    }
    const allowed =
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      deps.providers.some((provider) => provider.isProxyUrl(url));
    if (!allowed) throw new DomainError("FILE_NOT_FOUND", "This media URL is not served");
    try {
      return await deps.remote.open(url.toString(), { range: input.range ?? null });
    } catch (error) {
      throw new DomainError("MEDIA_SEARCH_FAILED", `Cannot load media: ${(error as Error).message}`);
    }
  };
}
