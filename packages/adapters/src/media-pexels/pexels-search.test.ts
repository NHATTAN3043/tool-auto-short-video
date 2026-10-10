import { describe, expect, it, vi } from "vitest";

import { describeVideoPage, PexelsSearch } from "./pexels-search";

const video = {
  id: 7,
  width: 1080,
  height: 1920,
  duration: 9,
  image: "https://images.pexels.com/videos/7/thumb.jpeg",
  video_files: [
    { width: 2160, height: 3840, link: "https://videos.pexels.com/7-uhd.mp4", file_type: "video/mp4" },
    { width: 1080, height: 1920, link: "https://videos.pexels.com/7-hd.mp4", file_type: "video/mp4" },
    { width: 360, height: 640, link: "https://videos.pexels.com/7-sd.mp4", file_type: "video/mp4" },
    {
      width: null,
      height: null,
      link: "https://videos.pexels.com/7.m3u8",
      file_type: "application/x-mpegURL",
    },
  ],
};

function setup(replies: (() => Response)[], now = () => 0) {
  const fetchFn = vi.fn<typeof fetch>(() => {
    const next = replies.shift();
    if (!next) throw new Error("unexpected request");
    return Promise.resolve(next());
  });
  const sleep = vi.fn(() => Promise.resolve());
  return { pexels: new PexelsSearch({ apiKey: "px-key", fetch: fetchFn, sleep, now }), fetchFn, sleep };
}

const search = { query: "mèo con", kind: "video" as const, lang: "vi" as const, perPage: 15 };

describe("PexelsSearch", () => {
  it("searches portrait videos in the query language with the key in the header", async () => {
    const s = setup([() => Response.json({ videos: [video] })]);
    expect(await s.pexels.search(search)).toEqual([
      {
        provider: "pexels",
        ref: "7",
        kind: "video",
        width: 1080,
        height: 1920,
        durationMs: 9000,
        thumbnail: { type: "remote", url: video.image },
        preview: { type: "remote", url: "https://videos.pexels.com/7-sd.mp4" },
      },
    ]);
    const [url, init] = s.fetchFn.mock.calls[0] ?? [];
    expect(url as string).toBe(
      "https://api.pexels.com/videos/search?query=m%C3%A8o+con&per_page=15&orientation=portrait&locale=vi-VN",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe("px-key");
  });

  it("describes candidates for text ranking: video page slug, photo alt text", async () => {
    const s = setup([
      () =>
        Response.json({
          videos: [{ ...video, url: "https://www.pexels.com/video/cat-walking-on-a-street-7/" }],
        }),
      () =>
        Response.json({
          photos: [
            {
              id: 9,
              width: 1080,
              height: 1920,
              alt: " Kitten sleeping on a sofa ",
              src: {
                original: "https://images.pexels.com/photos/9/a.jpeg",
                large: "https://images.pexels.com/photos/9/l.jpeg",
                medium: "https://images.pexels.com/photos/9/m.jpeg",
              },
            },
          ],
        }),
    ]);
    expect((await s.pexels.search(search))[0]?.description).toBe("cat walking on a street");
    expect((await s.pexels.search({ ...search, kind: "image" }))[0]?.description).toBe(
      "Kitten sleeping on a sofa",
    );
    expect(describeVideoPage("https://www.pexels.com/video/7/", 7)).toBeUndefined();
    expect(describeVideoPage("not a url", 7)).toBeUndefined();
  });

  it("answers the same search from its cache within an hour", async () => {
    let now = 0;
    const s = setup(
      [() => Response.json({ videos: [video] }), () => Response.json({ videos: [] })],
      () => now,
    );
    await s.pexels.search(search);
    now = 59 * 60 * 1000;
    expect(await s.pexels.search(search)).toHaveLength(1);
    now = 61 * 60 * 1000;
    expect(await s.pexels.search(search)).toEqual([]);
    expect(s.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("resolves a candidate from the search it came from, without another API call", async () => {
    const s = setup([() => Response.json({ videos: [video] })]);
    await s.pexels.search(search);
    expect(await s.pexels.resolve("video", "7")).toEqual({
      url: "https://videos.pexels.com/7-hd.mp4",
      extension: "mp4",
    });
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("resolves a video to its 1080p MP4 and a photo to a scaled-down original", async () => {
    const s = setup([
      () => Response.json(video),
      () =>
        Response.json({
          id: 3,
          width: 4000,
          height: 6000,
          src: {
            original: "https://images.pexels.com/photos/3/a.jpeg",
            large: "https://images.pexels.com/photos/3/a.jpeg?h=650",
            medium: "https://images.pexels.com/photos/3/a.jpeg?h=350",
          },
        }),
    ]);
    expect(await s.pexels.resolve("video", "7")).toEqual({
      url: "https://videos.pexels.com/7-hd.mp4",
      extension: "mp4",
    });
    expect((await s.pexels.resolve("image", "3")).url).toBe(
      "https://images.pexels.com/photos/3/a.jpeg?auto=compress&cs=tinysrgb&fit=max&w=2400&h=2400",
    );
    await expect(s.pexels.resolve("video", "../x")).rejects.toThrow(/Invalid/u);
  });

  it("retries 429/5xx at most twice and explains a rejected key", async () => {
    const busy = setup([() => new Response("", { status: 503 }), () => Response.json({ videos: [] })]);
    await busy.pexels.search(search);
    expect(busy.sleep).toHaveBeenCalledTimes(1);

    const down = setup([0, 1, 2].map(() => () => new Response("", { status: 500 })));
    await expect(down.pexels.search(search)).rejects.toMatchObject({ status: 500 });
    expect(down.fetchFn).toHaveBeenCalledTimes(3);

    const bad = setup([() => new Response("", { status: 401 })]);
    await expect(bad.pexels.search(search)).rejects.toThrow(/PEXELS_API_KEY/u);
  });

  it("proxies only Pexels media hosts", () => {
    const { pexels } = setup([]);
    expect(pexels.isProxyUrl(new URL("https://videos.pexels.com/a.mp4"))).toBe(true);
    expect(pexels.isProxyUrl(new URL("https://api.pexels.com/videos/search"))).toBe(false);
    expect(pexels.isProxyUrl(new URL("https://pexels.com.evil.test/a.mp4"))).toBe(false);
  });
});
