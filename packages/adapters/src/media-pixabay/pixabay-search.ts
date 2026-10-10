import {
  pickPreviewRendition,
  pickRendition,
  type MediaCandidate,
  type SearchLanguage,
} from "@studio/domain";
import type { MediaSearchPort, StockFile, StockSearch } from "@studio/services";
import { z } from "zod";

const LANGS: Record<SearchLanguage, string> = { en: "en", vi: "vi", zh: "zh" };
const MEDIA_HOSTS = ["cdn.pixabay.com", "pixabay.com"];
const MAX_RETRIES = 2;
/** Pixabay's API terms ask for results to be cached for 24 hours. */
const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_ENTRIES = 300;
/**
 * Download links seen in search results, so picking a candidate needs no second API call (that call is
 * what ran into Pixabay's rate limit). Image links are temporary, so they are trusted for an hour only.
 */
const FILE_CACHE_MS = 60 * 60 * 1000;
const FILE_CACHE_ENTRIES = 1000;
/** Longest wait inside a request when Pixabay asks to slow down. */
const MAX_RETRY_WAIT_MS = 10_000;

const VideoFileSchema = z.object({
  url: z.string(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  thumbnail: z.string().optional(),
});

/** Comma-separated keywords chosen by the uploader: the only description Pixabay gives. */
const TagsSchema = z.string().optional();

/** Pixabay tags as a candidate description. */
function describe(tags: string | undefined): { description?: string } {
  const text = tags?.trim() ?? "";
  return text === "" ? {} : { description: text.slice(0, 500) };
}

const VideoHitSchema = z.object({
  id: z.number(),
  tags: TagsSchema,
  duration: z.number().nonnegative(),
  videos: z.record(z.string(), VideoFileSchema),
});

const ImageHitSchema = z.object({
  id: z.number(),
  tags: TagsSchema,
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  previewURL: z.url().optional(),
  webformatURL: z.url(),
  largeImageURL: z.url(),
});

type ImageHit = z.infer<typeof ImageHitSchema>;

type VideoHit = z.infer<typeof VideoHitSchema>;

function files(hit: VideoHit) {
  return Object.values(hit.videos).filter((file) => file.url !== "" && file.width > 0 && file.height > 0);
}

export interface PixabaySearchOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  now?: () => number;
}

export class PixabayError extends Error {
  override readonly name = "PixabayError";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Pixabay videos and photos (free, API key). Retries at most twice, only on 429 and 5xx. */
export class PixabaySearch implements MediaSearchPort {
  readonly id = "pixabay" as const;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private readonly files = new Map<string, { at: number; file: StockFile }>();

  constructor(private readonly options: PixabaySearchOptions) {
    this.baseUrl = (options.baseUrl ?? "https://pixabay.com/api").replace(/\/+$/u, "");
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  async search(query: StockSearch): Promise<MediaCandidate[]> {
    const params = new URLSearchParams({
      q: query.query.slice(0, 100),
      lang: LANGS[query.lang],
      per_page: String(Math.max(3, query.perPage)),
      safesearch: "true",
    });
    if (query.kind === "video") {
      const body = z.object({ hits: z.array(VideoHitSchema) }).parse(await this.getJson("/videos/", params));
      return body.hits.flatMap((hit): MediaCandidate[] => {
        const largest = pickRendition(files(hit));
        const preview = pickPreviewRendition(files(hit));
        const thumbnail = preview?.thumbnail ?? largest?.thumbnail;
        if (!largest || !preview || !thumbnail) return [];
        this.remember("video", String(hit.id), { url: largest.url, extension: "mp4" });
        return [
          {
            provider: "pixabay",
            ref: String(hit.id),
            kind: "video",
            width: largest.width,
            height: largest.height,
            durationMs: Math.round(hit.duration * 1000),
            thumbnail: { type: "remote", url: thumbnail },
            preview: { type: "remote", url: preview.url },
            ...describe(hit.tags),
          },
        ];
      });
    }
    params.set("image_type", "photo");
    params.set("orientation", "vertical");
    const body = z.object({ hits: z.array(ImageHitSchema) }).parse(await this.getJson("/", params));
    return body.hits.map((hit) => {
      this.remember("image", String(hit.id), imageFile(cdnImage(hit, 1280) ?? hit.largeImageURL));
      const shown = cdnImage(hit, 640) ?? hit.webformatURL;
      return {
        provider: "pixabay" as const,
        ref: String(hit.id),
        kind: "image",
        width: hit.imageWidth,
        height: hit.imageHeight,
        thumbnail: { type: "remote" as const, url: shown },
        preview: { type: "remote" as const, url: shown },
        ...describe(hit.tags),
      };
    });
  }

  async resolve(kind: "video" | "image", ref: string): Promise<StockFile> {
    if (!/^\d+$/u.test(ref)) throw new PixabayError(400, `Invalid Pixabay id: ${ref}`);
    const known = this.files.get(`${kind}:${ref}`);
    if (known && this.now() - known.at < FILE_CACHE_MS) return known.file;
    const params = new URLSearchParams({ id: ref });
    if (kind === "video") {
      const body = z.object({ hits: z.array(VideoHitSchema) }).parse(await this.getJson("/videos/", params));
      const hit = body.hits[0];
      const file = hit ? pickRendition(files(hit)) : undefined;
      if (!file) throw new PixabayError(404, `Pixabay video ${ref} not found`);
      return { url: file.url, extension: "mp4" };
    }
    const body = z.object({ hits: z.array(ImageHitSchema) }).parse(await this.getJson("/", params));
    const hit = body.hits[0];
    if (!hit) throw new PixabayError(404, `Pixabay image ${ref} not found`);
    return imageFile(cdnImage(hit, 1280) ?? hit.largeImageURL);
  }

  private remember(kind: "video" | "image", ref: string, file: StockFile): void {
    if (this.files.size >= FILE_CACHE_ENTRIES) this.files.delete(this.files.keys().next().value ?? "");
    this.files.set(`${kind}:${ref}`, { at: this.now(), file });
  }

  isProxyUrl(url: URL): boolean {
    return MEDIA_HOSTS.includes(url.hostname);
  }

  private async getJson(path: string, params: URLSearchParams): Promise<unknown> {
    // The cache key leaves the API key out.
    const cacheKey = `${path}?${params.toString()}`;
    const hit = this.cache.get(cacheKey);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.value;
    const url = `${this.baseUrl}${path}?${new URLSearchParams([["key", this.options.apiKey], ...params]).toString()}`;
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchFn(url, { signal: AbortSignal.timeout(20_000) });
      if (response.ok) {
        const value: unknown = await response.json();
        if (this.cache.size >= CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value ?? "");
        this.cache.set(cacheKey, { at: this.now(), value });
        return value;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        await response.body?.cancel();
        // Never put the request URL in the message: it contains the key.
        throw new PixabayError(
          response.status,
          response.status === 400 || response.status === 401 || response.status === 403
            ? `Pixabay từ chối yêu cầu (${String(response.status)}), kiểm tra PIXABAY_API_KEY`
            : response.status === 429
              ? "Pixabay: gọi quá nhanh, thử lại sau một phút"
              : `Pixabay ${String(response.status)}`,
        );
      }
      await response.body?.cancel();
      await this.sleep(retryDelay(response, (this.options.retryDelayMs ?? 1000) * 2 ** attempt));
    }
  }
}

/**
 * The same photo on cdn.pixabay.com. `webformatURL`/`largeImageURL` live on pixabay.com/get, which sits
 * behind Cloudflare and answers a grid of thumbnails with 429; the CDN serves `_640`/`_1280` next to the
 * `_150` preview without that limit. Undefined when the preview link does not have that shape.
 */
function cdnImage(hit: ImageHit, size: 640 | 1280): string | undefined {
  const url = hit.previewURL;
  if (url === undefined || !url.startsWith("https://cdn.pixabay.com/") || !/_150\.(jpe?g|png)$/iu.test(url)) {
    return undefined;
  }
  return url.replace(/_150\.(jpe?g|png)$/iu, `_${String(size)}.$1`);
}

function imageFile(url: string): StockFile {
  return { url, extension: url.toLowerCase().endsWith(".png") ? "png" : "jpg" };
}

/** Pixabay says when its per-minute window resets (`X-RateLimit-Reset`, seconds); wait for that, capped. */
function retryDelay(response: Response, fallbackMs: number): number {
  const seconds = Number(response.headers.get("x-ratelimit-reset") ?? response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_WAIT_MS) : fallbackMs;
}
