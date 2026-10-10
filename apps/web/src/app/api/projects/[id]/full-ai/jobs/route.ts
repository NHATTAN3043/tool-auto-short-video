import { requireAi, FullAiBodySchema } from "@/server/ai";
import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Queues a Full AI run for the worker. 202: accepted; poll it through /renders/:jobId. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const requestFullAi = requireAi(getContainer().requestFullAi);
    const { request: body } = await parseJsonBody(request, FullAiBodySchema);
    return jsonOk(await requestFullAi({ projectId: id, request: body }), 202);
  } catch (error) {
    return toErrorResponse(error);
  }
}
