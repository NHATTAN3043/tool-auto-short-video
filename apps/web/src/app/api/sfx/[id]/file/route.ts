import { getContainer } from "@/server/container";
import { fileResponse } from "@/server/file-response";
import { toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function serve(request: Request, { params }: RouteContext, withBody: boolean): Promise<Response> {
  try {
    const { id } = await params;
    const result = await getContainer().readLibrarySfxFile({ id, range: request.headers.get("range") });
    return fileResponse(result, withBody);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** The audio file of a library effect, for listening before picking it. */
export function GET(request: Request, context: RouteContext) {
  return serve(request, context, true);
}

export function HEAD(request: Request, context: RouteContext) {
  return serve(request, context, false);
}
