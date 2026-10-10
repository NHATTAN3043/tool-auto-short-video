import { describe, expect, it, vi } from "vitest";

import { PixabaySearch } from "./pixabay-search";

const hit = {
  id: 42,
  duration: 12,
  videos: {
    large: {
      url: "https://cdn.pixabay.com/42-large.mp4",
      width: 1920,
      height: 1080,
      thumbnail: "https://cdn.pixabay.com/42-l.jpg",
    },
    medium: {
      url: "https://cdn.pixabay.com/42-medium.mp4",
      width: 1280,
      height: 720,
      thumbnail: "https://cdn.pixabay.com/42-m.jpg",
    },
    tiny: {
      url: "https://cdn.pixabay.com/42-tiny.mp4",
      width: 640,
      height: 360,
      thumbnail: "https://cdn.pixabay.com/42-t.jpg",
    },
    xlarge: { url: "", width: 0, height: 0 },
  },
};

function setup(replies: (() => Response)[]) {
  const fetchFn = vi.fn<typeof fetch>(() => {
    const next = replies.shift();
    if (!next) throw new Error("unexpected request");
    return Promise.resolve(next());
  });
  const sleep = vi.fn(() => Promise.resolve());
  return {
    pixabay: new PixabaySearch({ apiKey: "pb-key", fetch: fetchFn, sleep, now: () => 0 }),
    fetchFn,
    sleep,
  };
}

describe("PixabaySearch", () => {
  it("searches videos in the query language and keeps the key out of results", async () => {
    const s = setup([() => Response.json({ hits: [hit] })]);
    const [candidate] = await s.pixabay.search({ query: "小猫", kind: "video", lang: "zh", perPage: 15 });
    expect(candidate).toEqual({
      provider: "pixabay",
      ref: "42",
      kind: "video",
      width: 1920,
      height: 1080,
      durationMs: 12_000,
      thumbnail: { type: "remote", url: "https://cdn.pixabay.com/42-t.jpg" },
      preview: { type: "remote", url: "https://cdn.pixabay.com/42-tiny.mp4" },
    });
    const url = new URL(s.fetchFn.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe("/api/videos/");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ key: "pb-key", q: "小猫", lang: "zh" });
    expect(JSON.stringify(candidate)).not.toContain("pb-key");
  });

  it("describes candidates with their tags for text ranking", async () => {
    const s = setup([() => Response.json({ hits: [{ ...hit, tags: "cat, kitten, pet" }] })]);
    const [candidate] = await s.pixabay.search({ query: "cat", kind: "video", lang: "en", perPage: 15 });
    expect(candidate?.description).toBe("cat, kitten, pet");
  });

  it("searches vertical photos and caches the answer", async () => {
    const s = setup([
      () =>
        Response.json({
          hits: [
            {
              id: 5,
              imageWidth: 3000,
              imageHeight: 4500,
              webformatURL: "https://pixabay.com/get/5_640.jpg",
              largeImageURL: "https://pixabay.com/get/5_1280.jpg",
            },
          ],
        }),
    ]);
    const query = { query: "cat", kind: "image" as const, lang: "en" as const, perPage: 15 };
    expect((await s.pixabay.search(query))[0]).toMatchObject({ ref: "5", kind: "image", height: 4500 });
    await s.pixabay.search(query);
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
    expect(new URL(s.fetchFn.mock.calls[0]?.[0] as string).searchParams.get("orientation")).toBe("vertical");
  });

  it("serves photos from cdn.pixabay.com, which does not rate-limit thumbnail grids", async () => {
    const s = setup([
      () =>
        Response.json({
          hits: [
            {
              id: 7,
              imageWidth: 3000,
              imageHeight: 4500,
              previewURL: "https://cdn.pixabay.com/photo/2017/02/20/18/03/cat-7_150.jpg",
              webformatURL: "https://pixabay.com/get/7_640.jpg",
              largeImageURL: "https://pixabay.com/get/7_1280.jpg",
            },
          ],
        }),
    ]);
    const [candidate] = await s.pixabay.search({ query: "cat", kind: "image", lang: "en", perPage: 15 });
    expect(candidate?.thumbnail).toEqual({
      type: "remote",
      url: "https://cdn.pixabay.com/photo/2017/02/20/18/03/cat-7_640.jpg",
    });
    expect(await s.pixabay.resolve("image", "7")).toEqual({
      url: "https://cdn.pixabay.com/photo/2017/02/20/18/03/cat-7_1280.jpg",
      extension: "jpg",
    });
  });

  it("resolves a candidate from the search it came from, without another API call", async () => {
    const s = setup([() => Response.json({ hits: [hit] })]);
    await s.pixabay.search({ query: "cat", kind: "video", lang: "en", perPage: 15 });
    expect(await s.pixabay.resolve("video", "42")).toEqual({
      url: "https://cdn.pixabay.com/42-large.mp4",
      extension: "mp4",
    });
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("waits for the rate-limit reset Pixabay announces, capped at 10 seconds", async () => {
    const s = setup([
      () => new Response("", { status: 429, headers: { "x-ratelimit-reset": "4" } }),
      () => new Response("", { status: 429, headers: { "x-ratelimit-reset": "60" } }),
      () => Response.json({ hits: [hit] }),
    ]);
    await s.pixabay.resolve("video", "42");
    expect(s.sleep.mock.calls).toEqual([[4000], [10_000]]);
  });

  it("resolves a video id to its 1080p file", async () => {
    const s = setup([() => Response.json({ hits: [hit] })]);
    expect(await s.pixabay.resolve("video", "42")).toEqual({
      url: "https://cdn.pixabay.com/42-large.mp4",
      extension: "mp4",
    });
    expect(new URL(s.fetchFn.mock.calls[0]?.[0] as string).searchParams.get("id")).toBe("42");
  });

  it("never puts the key in error messages and retries only 429/5xx", async () => {
    const bad = setup([() => new Response("[ERROR 400] Invalid or missing API key", { status: 400 })]);
    const error = await bad.pixabay
      .search({ query: "x", kind: "video", lang: "en", perPage: 3 })
      .catch((e: unknown) => e);
    expect(String(error)).toMatch(/PIXABAY_API_KEY/u);
    expect(String(error)).not.toContain("pb-key");
    expect(bad.fetchFn).toHaveBeenCalledTimes(1);

    const busy = setup([() => new Response("", { status: 429 }), () => Response.json({ hits: [] })]);
    await busy.pixabay.search({ query: "x", kind: "video", lang: "en", perPage: 3 });
    expect(busy.sleep).toHaveBeenCalledTimes(1);
  });

  it("proxies only Pixabay media hosts", () => {
    const { pixabay } = setup([]);
    expect(pixabay.isProxyUrl(new URL("https://cdn.pixabay.com/a.mp4"))).toBe(true);
    expect(pixabay.isProxyUrl(new URL("https://example.com/a.mp4"))).toBe(false);
  });
});
