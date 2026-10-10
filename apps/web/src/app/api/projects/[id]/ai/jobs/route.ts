import { requireAi, AiTaskBodySchema } from "@/server/ai";
import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Queues an AI task for the worker. 202: accepted; poll it through /renders/:jobId. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const requestAiTask = requireAi(getContainer().requestAiTask);
    const { task } = await parseJsonBody(request, AiTaskBodySchema);
    return jsonOk(await requestAiTask({ projectId: id, task }), 202);
  } catch (error) {
    return toErrorResponse(error);
  }
}
