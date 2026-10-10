import { requireAi } from "@/server/ai";
import { getContainer } from "@/server/container";
import { jsonOk, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string; jobId: string }>;
}

/** The suggestion of a finished AI job, for review. Nothing is applied to the project here. */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id, jobId } = await params;
    return jsonOk(await requireAi(getContainer().getAiResult)({ projectId: id, jobId }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
