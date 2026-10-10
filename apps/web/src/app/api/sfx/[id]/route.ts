import { z } from "zod";

import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { name } = await parseJsonBody(request, z.object({ name: z.string() }));
    return jsonOk(await getContainer().renameLibrarySfx({ id, name }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Removes the effect from the library; projects that use it keep their own copy. */
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    await getContainer().removeLibrarySfx(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
