import { PickedCandidateSchema } from "@studio/domain";
import { z } from "zod";

import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ImportBodySchema = z.object({ candidate: PickedCandidateSchema, query: z.string().trim().max(100) });

/**
 * Makes the picked candidate a project asset (downloading stock into the shared library first) and
 * returns it, with where the scene starts in it when the pick is one shot of an analyzed clip. Assigning it to the scene is the editor's job, so only that scene changes.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { candidate, query } = await parseJsonBody(request, ImportBodySchema);
    const { asset, startMs } = await getContainer().importMediaCandidate({ projectId: id, candidate, query });
    return jsonOk({ asset, ...(startMs !== undefined && { startMs }) }, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
