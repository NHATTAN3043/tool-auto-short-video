import "server-only";

import type { ReadProjectFileResult } from "@studio/services";

import { toWebStream } from "@/server/upload";

/** Turns a file read result into a Range-aware response for `<video>`/`<audio>`. */
export function fileResponse(result: ReadProjectFileResult, withBody: boolean): Response {
  if (result.status === 416) {
    return new Response(null, {
      status: 416,
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${String(result.size)}` },
    });
  }
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": result.contentType,
    "Content-Length": String(Math.max(0, result.end - result.start + 1)),
    "Cache-Control": result.immutable ? "private, max-age=31536000, immutable" : "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (result.status === 206) {
    headers.set(
      "Content-Range",
      `bytes ${String(result.start)}-${String(result.end)}/${String(result.size)}`,
    );
  }
  return new Response(withBody ? toWebStream(result.body) : null, { status: result.status, headers });
}
