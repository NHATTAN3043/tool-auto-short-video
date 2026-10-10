import { RenderJobKindSchema } from "@studio/domain";
import { z } from "zod";

import { getContainer } from "@/server/container";
import { jsonOk, parseOptionalJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Voice and AI jobs are queued through their own routes, which validate their input.
const RenderRequestSchema = z.object({ kind: RenderJobKindSchema.extract(["video", "capcut"]).optional() });

/**
 * Queues a render of the saved project; the worker picks it up. 202: accepted, not done. Body (optional):
 * `{ kind: "capcut" }` for the CapCut package instead of the MP4.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { kind } = await parseOptionalJsonBody(request, RenderRequestSchema, {});
    return jsonOk(await getContainer().requestRender({ projectId: id, ...(kind && { kind }) }), 202);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Render history of the project, newest first. */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    return jsonOk(await getContainer().listRenderJobs({ projectId: id }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
