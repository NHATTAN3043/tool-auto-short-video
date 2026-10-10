import { getContainer } from "@/server/container";
import { fileResponse } from "@/server/file-response";
import { toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function serve(request: Request, { params }: RouteContext, withBody: boolean): Promise<Response> {
  try {
    const { id } = await params;
    const file = new URL(request.url).searchParams.get("file") === "thumbnail" ? "thumbnail" : "media";
    const result = await getContainer().readLibraryMediaFile({
      id,
      file,
      range: request.headers.get("range"),
    });
    return fileResponse(result, withBody);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** `?file=media|thumbnail` of a shared library item, with Range support for previews. */
export function GET(request: Request, context: RouteContext) {
  return serve(request, context, true);
}

export function HEAD(request: Request, context: RouteContext) {
  return serve(request, context, false);
}
