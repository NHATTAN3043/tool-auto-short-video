import { requireAi, FullAiBodySchema } from "@/server/ai";
import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Steps and estimated cost of a Full AI run, and the budgets, before the user confirms. No paid call. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const estimateFullAi = requireAi(getContainer().estimateFullAi);
    const { request: body } = await parseJsonBody(request, FullAiBodySchema);
    return jsonOk(await estimateFullAi({ projectId: id, request: body }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
