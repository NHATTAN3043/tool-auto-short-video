import { z } from "zod";

import { getContainer } from "@/server/container";
import { fileResponse } from "@/server/file-response";
import { toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const QuerySchema = z.object({
  file: z.enum(["media", "thumbnail", "shot"]).catch("media"),
  shot: z.coerce.number().int().nonnegative().optional(),
});

async function serve(request: Request, { params }: RouteContext, withBody: boolean): Promise<Response> {
  try {
    const { id } = await params;
    const query = QuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const result = await getContainer().readLibraryMediaFile({
      id,
      file: query.file,
      ...(query.shot !== undefined && { shot: query.shot }),
      range: request.headers.get("range"),
    });
    return fileResponse(result, withBody);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** `?file=media|thumbnail`, or `?file=shot&shot=N`, of a shared library item, with Range support for previews. */
export function GET(request: Request, context: RouteContext) {
  return serve(request, context, true);
}

export function HEAD(request: Request, context: RouteContext) {
  return serve(request, context, false);
}
