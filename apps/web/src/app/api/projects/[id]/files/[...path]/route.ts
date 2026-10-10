import { getContainer } from "@/server/container";
import { fileResponse } from "@/server/file-response";
import { toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string; path: string[] }>;
}

async function serve(request: Request, { params }: RouteContext, withBody: boolean): Promise<Response> {
  try {
    const { id, path } = await params;
    const result = await getContainer().readProjectFile({
      projectId: id,
      path,
      range: request.headers.get("range"),
    });
    return fileResponse(result, withBody);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Media, thumbnails and renders of a project, with Range support so `<video>` can seek. */
export function GET(request: Request, context: RouteContext) {
  return serve(request, context, true);
}

export function HEAD(request: Request, context: RouteContext) {
  return serve(request, context, false);
}
