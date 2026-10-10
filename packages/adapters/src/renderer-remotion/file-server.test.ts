import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startFileServer, type FileServer } from "./file-server";

/** Raw request, so paths like `/../x` reach the server unnormalized (fetch would normalize them). */
function get(
  server: FileServer,
  rawPath: string,
  headers: Record<string, string> = {},
  method = "GET",
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const { port } = new URL(server.baseUrl);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: rawPath, method, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("startFileServer", () => {
  let root = "";
  let parent = "";
  let server: FileServer;

  beforeAll(async () => {
    parent = mkdtempSync(path.join(tmpdir(), "studio-serve-"));
    root = path.join(parent, "project");
    mkdirSync(path.join(root, "media"), { recursive: true });
    writeFileSync(path.join(root, "media", "clip one.mp4"), "0123456789");
    writeFileSync(path.join(root, "media", "voice.mp3"), "abc");
    writeFileSync(path.join(root, "media", "empty.png"), "");
    writeFileSync(path.join(parent, "secret.txt"), "top secret");
    server = await startFileServer(root);
  });

  afterAll(async () => {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  });

  it("serves whole files with content type and range support advertised", async () => {
    const res = await get(server, new URL(server.urlFor("media/clip one.mp4")).pathname);
    expect(res).toMatchObject({ status: 200, body: "0123456789" });
    expect(res.headers).toMatchObject({
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      "content-length": "10",
      "access-control-allow-origin": "*",
    });
    expect((await get(server, "/media/voice.mp3")).headers["content-type"]).toBe("audio/mpeg");
  });

  it("answers range requests with 206 and Content-Range", async () => {
    const res = await get(server, "/media/clip%20one.mp4", { Range: "bytes=2-5" });
    expect(res).toMatchObject({ status: 206, body: "2345" });
    expect(res.headers["content-range"]).toBe("bytes 2-5/10");
  });

  it("answers unsatisfiable ranges with 416", async () => {
    const res = await get(server, "/media/clip%20one.mp4", { Range: "bytes=50-" });
    expect(res.status).toBe(416);
    expect(res.headers["content-range"]).toBe("bytes */10");
  });

  it("handles HEAD and empty files", async () => {
    expect(await get(server, "/media/voice.mp3", {}, "HEAD")).toMatchObject({ status: 200, body: "" });
    expect(await get(server, "/media/empty.png")).toMatchObject({ status: 200, body: "" });
    expect((await get(server, "/media/voice.mp3", {}, "POST")).status).toBe(405);
  });

  it.each([
    "/../secret.txt",
    "/media/../../secret.txt",
    "/%2e%2e/secret.txt",
    "/media%2F..%2F..%2Fsecret.txt",
    "/..%5Csecret.txt",
    "/%00",
    "/%E0%A4%A",
    "/media",
    "/media/missing.mp4",
  ])("never serves %s", async (rawPath) => {
    const res = await get(server, rawPath);
    expect(res.status).toBe(404);
    expect(res.body).not.toContain("top secret");
  });
});
