import { requireAi, AiTaskBodySchema } from "@/server/ai";
import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Estimated cost of an AI task and the daily budget left, shown before the user confirms. No paid call. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const estimateAiTask = requireAi(getContainer().estimateAiTask);
    const { task } = await parseJsonBody(request, AiTaskBodySchema);
    return jsonOk(await estimateAiTask({ projectId: id, task }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
