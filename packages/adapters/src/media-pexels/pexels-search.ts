import {
  pickPreviewRendition,
  pickRendition,
  type MediaCandidate,
  type SearchLanguage,
} from "@studio/domain";
import type { MediaSearchPort, StockFile, StockSearch } from "@studio/services";
import { z } from "zod";

const LOCALES: Record<SearchLanguage, string> = { en: "en-US", vi: "vi-VN", zh: "zh-CN" };
const MEDIA_HOSTS = ["images.pexels.com", "videos.pexels.com", "player.vimeo.com"];
const MAX_RETRIES = 2;
/** Pexels allows 200 requests an hour; the same search within an hour is answered from memory. */
const CACHE_MS = 60 * 60 * 1000;
const CACHE_ENTRIES = 200;
/** Download links seen in search results: picking a candidate then needs no second API call. */
const FILE_CACHE_MS = 60 * 60 * 1000;
const FILE_CACHE_ENTRIES = 1000;
/** Longest wait inside a request when Pexels asks to slow down. */
const MAX_RETRY_WAIT_MS = 10_000;

const VideoFileSchema = z.object({
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  link: z.url(),
  file_type: z.string().nullable().optional(),
});

const VideoSchema = z.object({
  id: z.number(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().nonnegative(),
  image: z.url(),
  /** Page of the video, e.g. https://www.pexels.com/video/cat-walking-on-a-street-123/ */
  url: z.string().optional(),
  video_files: z.array(VideoFileSchema),
});

const PhotoSchema = z.object({
  id: z.number(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  src: z.object({ original: z.url(), large: z.url(), medium: z.url() }),
  alt: z.string().nullable().optional(),
});

const MAX_DESCRIPTION = 500;

/** Pexels videos have no text but their page slug: `.../video/cat-walking-on-a-street-123/` → words. */
export function describeVideoPage(pageUrl: string | undefined, id: number): string | undefined {
  if (pageUrl === undefined) return undefined;
  let slug: string;
  try {
    slug =
      new URL(pageUrl).pathname
        .split("/")
        .filter((part) => part !== "")
        .at(-1) ?? "";
  } catch {
    return undefined;
  }
  const words = slug
    .replace(new RegExp(`-?${String(id)}$`, "u"), "")
    .replace(/-+/gu, " ")
    .trim();
  return words === "" ? undefined : words.slice(0, MAX_DESCRIPTION);
}

type Video = z.infer<typeof VideoSchema>;

function mp4Files(video: Video) {
  return video.video_files.flatMap((file) =>
    file.width !== null && file.height !== null && (file.file_type ?? "video/mp4") === "video/mp4"
      ? [{ width: file.width, height: file.height, url: file.link }]
      : [],
  );
}

/** A photo scaled down to at most 2400 px on its long side through Pexels' image service. */
function photoDownloadUrl(original: string): string {
  const url = new URL(original);
  url.search = "auto=compress&cs=tinysrgb&fit=max&w=2400&h=2400";
  return url.toString();
}

export interface PexelsSearchOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  now?: () => number;
}

export class PexelsError extends Error {
  override readonly name = "PexelsError";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Pexels videos and photos (free, API key). Retries at most twice, only on 429 and 5xx. */
export class PexelsSearch implements MediaSearchPort {
  readonly id = "pexels" as const;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private readonly files = new Map<string, { at: number; file: StockFile }>();

  constructor(private readonly options: PexelsSearchOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.pexels.com").replace(/\/+$/u, "");
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  async search(query: StockSearch): Promise<MediaCandidate[]> {
    const params = new URLSearchParams({
      query: query.query,
      per_page: String(query.perPage),
      orientation: "portrait",
      locale: LOCALES[query.lang],
    });
    if (query.kind === "video") {
      const body = z
        .object({ videos: z.array(VideoSchema) })
        .parse(await this.getJson(`/videos/search?${params.toString()}`));
      return body.videos.flatMap((video): MediaCandidate[] => {
        const preview = pickPreviewRendition(mp4Files(video));
        const download = pickRendition(mp4Files(video));
        if (!preview || !download) return [];
        this.remember("video", String(video.id), { url: download.url, extension: "mp4" });
        const description = describeVideoPage(video.url, video.id);
        return [
          {
            provider: "pexels",
            ref: String(video.id),
            kind: "video",
            width: video.width,
            height: video.height,
            durationMs: Math.round(video.duration * 1000),
            thumbnail: { type: "remote", url: video.image },
            preview: { type: "remote", url: preview.url },
            ...(description !== undefined && { description }),
          },
        ];
      });
    }
    const body = z
      .object({ photos: z.array(PhotoSchema) })
      .parse(await this.getJson(`/v1/search?${params.toString()}`));
    return body.photos.map((photo) => {
      this.remember("image", String(photo.id), {
        url: photoDownloadUrl(photo.src.original),
        extension: "jpg",
      });
      const alt = photo.alt?.trim() ?? "";
      return {
        provider: "pexels" as const,
        ref: String(photo.id),
        kind: "image",
        width: photo.width,
        height: photo.height,
        thumbnail: { type: "remote" as const, url: photo.src.medium },
        preview: { type: "remote" as const, url: photo.src.large },
        ...(alt !== "" && { description: alt.slice(0, MAX_DESCRIPTION) }),
      };
    });
  }

  async resolve(kind: "video" | "image", ref: string): Promise<StockFile> {
    if (!/^\d+$/u.test(ref)) throw new PexelsError(400, `Invalid Pexels id: ${ref}`);
    const known = this.files.get(`${kind}:${ref}`);
    if (known && this.now() - known.at < FILE_CACHE_MS) return known.file;
    if (kind === "video") {
      const video = VideoSchema.parse(await this.getJson(`/videos/videos/${ref}`, false));
      const file = pickRendition(mp4Files(video));
      if (!file) throw new PexelsError(404, `Pexels video ${ref} has no MP4 file`);
      return { url: file.url, extension: "mp4" };
    }
    const photo = PhotoSchema.parse(await this.getJson(`/v1/photos/${ref}`, false));
    return { url: photoDownloadUrl(photo.src.original), extension: "jpg" };
  }

  private remember(kind: "video" | "image", ref: string, file: StockFile): void {
    if (this.files.size >= FILE_CACHE_ENTRIES) this.files.delete(this.files.keys().next().value ?? "");
    this.files.set(`${kind}:${ref}`, { at: this.now(), file });
  }

  isProxyUrl(url: URL): boolean {
    return MEDIA_HOSTS.includes(url.hostname);
  }

  private async getJson(path: string, cached = true): Promise<unknown> {
    const hit = this.cache.get(path);
    if (cached && hit && this.now() - hit.at < CACHE_MS) return hit.value;
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        headers: { Authorization: this.options.apiKey },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const value: unknown = await response.json();
        if (cached) {
          if (this.cache.size >= CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value ?? "");
          this.cache.set(path, { at: this.now(), value });
        }
        return value;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        await response.body?.cancel();
        throw new PexelsError(
          response.status,
          response.status === 401 || response.status === 403
            ? "Pexels từ chối API key (PEXELS_API_KEY)"
            : response.status === 429
              ? "Pexels: đã hết lượt tìm trong giờ này, thử lại sau"
              : `Pexels ${String(response.status)}`,
        );
      }
      await response.body?.cancel();
      await this.sleep(retryDelay(response, (this.options.retryDelayMs ?? 1000) * 2 ** attempt));
    }
  }
}

/** Pexels says when its window resets (`X-Ratelimit-Reset`, a UNIX time); wait for that, capped. */
function retryDelay(response: Response, fallbackMs: number): number {
  const resetAt = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(resetAt) && resetAt > 0) {
    const waitMs = resetAt * 1000 - Date.now();
    if (waitMs > 0) return Math.min(waitMs, MAX_RETRY_WAIT_MS);
  }
  return fallbackMs;
}
