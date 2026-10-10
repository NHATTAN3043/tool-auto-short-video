import { getContainer } from "@/server/container";
import { toErrorResponse } from "@/server/http";
import { toWebStream } from "@/server/upload";

async function serve(request: Request, withBody: boolean): Promise<Response> {
  try {
    const url = new URL(request.url).searchParams.get("url") ?? "";
    const file = await getContainer().proxyStockMedia({ url, range: request.headers.get("range") });
    const headers = new Headers({
      "Content-Type": file.contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    if (file.contentLength !== undefined) headers.set("Content-Length", String(file.contentLength));
    if (file.contentRange !== undefined) headers.set("Content-Range", file.contentRange);
    return new Response(withBody ? toWebStream(file.body) : null, { status: file.status, headers });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * A stock thumbnail or preview video, fetched by the server so the browser never calls Pexels/Pixabay.
 * Only the providers' media hosts are served; Range is passed through so previews can be scrubbed.
 */
export function GET(request: Request) {
  return serve(request, true);
}

export function HEAD(request: Request) {
  return serve(request, false);
}
