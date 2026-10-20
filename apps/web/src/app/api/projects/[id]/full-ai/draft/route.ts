import { FullAiDraftSchema } from "@studio/domain";
import { z } from "zod";

import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** The project's Full AI draft (ADR 0015), or null when there is none. */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    return jsonOk({ draft: await getContainer().getFullAiDraft(id) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { draft } = await parseJsonBody(request, z.object({ draft: FullAiDraftSchema }));
    return jsonOk({ draft: await getContainer().saveFullAiDraft({ projectId: id, draft }) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Starts over. */
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    await getContainer().deleteFullAiDraft(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
