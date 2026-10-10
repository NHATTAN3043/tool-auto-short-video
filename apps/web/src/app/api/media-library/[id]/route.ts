import { z } from "zod";

import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Replaces the tags of a library item. */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { tags } = await parseJsonBody(request, z.object({ tags: z.array(z.string()).max(50) }));
    return jsonOk(await getContainer().setLibraryMediaTags({ id, tags }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Removes the item from the shared library; projects keep their own copies. */
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    await getContainer().removeLibraryMedia(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
