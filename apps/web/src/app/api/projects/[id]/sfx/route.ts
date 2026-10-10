import { z } from "zod";

import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Copies a library effect into the project (once) and returns the project audio asset. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { sfxId } = await parseJsonBody(request, z.object({ sfxId: z.string().min(1) }));
    return jsonOk(await getContainer().useLibrarySfxInProject({ projectId: id, sfxId }), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
