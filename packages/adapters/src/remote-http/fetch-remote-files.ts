import type { RemoteFile, RemoteFilePort } from "@studio/services";

export interface FetchRemoteFilesOptions {
  fetch?: typeof fetch;
  /** Until the response headers arrive. */
  connectTimeoutMs?: number;
}

/** Public HTTPS files through `fetch`, streamed. Redirects are followed but must stay on HTTPS. */
export class FetchRemoteFiles implements RemoteFilePort {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: FetchRemoteFilesOptions = {}) {
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async open(url: string, options: { range?: string | null } = {}): Promise<RemoteFile> {
    if (!url.startsWith("https://")) throw new Error("Only HTTPS files are fetched");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.options.connectTimeoutMs ?? 20_000);
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: options.range ? { Range: options.range } : {},
        redirect: "follow",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.url.startsWith("https://") && response.url !== "") {
      await response.body?.cancel();
      throw new Error("Redirected away from HTTPS");
    }
    if ((response.status !== 200 && response.status !== 206) || !response.body) {
      await response.body?.cancel();
      throw new Error(`HTTP ${String(response.status)}`);
    }
    const length = Number(response.headers.get("content-length"));
    const file: RemoteFile = {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      body: response.body,
    };
    if (Number.isFinite(length) && length >= 0 && response.headers.has("content-length")) {
      file.contentLength = length;
    }
    const range = response.headers.get("content-range");
    if (range !== null) file.contentRange = range;
    return file;
  }
}
