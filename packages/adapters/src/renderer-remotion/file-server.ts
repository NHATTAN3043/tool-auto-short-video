import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { contentTypeForFileName, parseByteRange } from "@studio/domain";

export interface FileServer {
  baseUrl: string;
  /** URL for a path relative to the served folder, e.g. `media/ast_1.mp4`. */
  urlFor(relativePath: string): string;
  close(): Promise<void>;
}

function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const resolved = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

async function handle(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const file = resolveInside(root, new URL(req.url ?? "/", "http://localhost").pathname);
  const info = file ? await stat(file).catch(() => null) : null;
  if (!file || !info?.isFile()) {
    res.writeHead(404).end();
    return;
  }

  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type": contentTypeForFileName(file),
  };
  const range = parseByteRange(req.headers.range, info.size);
  if (range === "invalid") {
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${String(info.size)}` }).end();
    return;
  }
  const { start, end } = range ?? { start: 0, end: info.size - 1 };
  res.writeHead(range ? 206 : 200, {
    ...headers,
    "Content-Length": String(Math.max(0, end - start + 1)),
    ...(range && { "Content-Range": `bytes ${String(start)}-${String(end)}/${String(info.size)}` }),
  });
  if (req.method === "HEAD" || info.size === 0) {
    res.end();
    return;
  }
  createReadStream(file, { start, end })
    .on("error", () => res.destroy())
    .pipe(res);
}

/**
 * Serves one project folder on a random local port. The renderer's headless browser needs HTTP URLs
 * (not file paths), and seeking in video needs Range support.
 */
export async function startFileServer(rootDir: string): Promise<FileServer> {
  const root = path.resolve(rootDir);
  const server = createServer((req, res) => {
    handle(root, req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return {
    baseUrl,
    urlFor: (relativePath) => `${baseUrl}/${relativePath.split("/").map(encodeURIComponent).join("/")}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
