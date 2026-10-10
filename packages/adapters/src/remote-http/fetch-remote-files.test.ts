import { describe, expect, it, vi } from "vitest";

import { FetchRemoteFiles } from "./fetch-remote-files";

async function text(body: AsyncIterable<Uint8Array>): Promise<string> {
  let result = "";
  for await (const chunk of body) result += new TextDecoder().decode(chunk);
  return result;
}

function response(body: string, init: ResponseInit, url = "https://cdn.test/a.mp4"): Response {
  const res = new Response(body, init);
  Object.defineProperty(res, "url", { value: url });
  return res;
}

describe("FetchRemoteFiles", () => {
  it("streams the body and passes the Range header through", async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        response("abc", {
          status: 206,
          headers: { "content-type": "video/mp4", "content-length": "3", "content-range": "bytes 0-2/10" },
        }),
      ),
    );
    const file = await new FetchRemoteFiles({ fetch: fetchFn }).open("https://cdn.test/a.mp4", {
      range: "bytes=0-2",
    });
    expect(file).toMatchObject({
      status: 206,
      contentType: "video/mp4",
      contentLength: 3,
      contentRange: "bytes 0-2/10",
    });
    expect(await text(file.body)).toBe("abc");
    expect(new Headers(fetchFn.mock.calls[0]?.[1]?.headers).get("range")).toBe("bytes=0-2");
  });

  it("refuses plain HTTP, redirects away from HTTPS and error statuses", async () => {
    const remote = (res: Response) => new FetchRemoteFiles({ fetch: () => Promise.resolve(res) });
    await expect(remote(response("", { status: 200 })).open("http://cdn.test/a.mp4")).rejects.toThrow(
      /HTTPS/u,
    );
    await expect(
      remote(response("x", { status: 200 }, "http://evil.test/a.mp4")).open("https://cdn.test/a.mp4"),
    ).rejects.toThrow(/Redirected/u);
    await expect(remote(response("", { status: 404 })).open("https://cdn.test/a.mp4")).rejects.toThrow(
      /404/u,
    );
  });
});
