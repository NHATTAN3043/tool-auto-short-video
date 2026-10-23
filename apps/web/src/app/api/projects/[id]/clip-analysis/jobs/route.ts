import { ClipAnalysisBodySchema, requireAi } from "@/server/ai";
import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Queues the analysis for the worker, paid by this project's budget. 202: poll it through /renders/:jobId. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const requestAnalysis = requireAi(getContainer().requestClipAnalysis);
    const body = await parseJsonBody(request, ClipAnalysisBodySchema);
    return jsonOk(await requestAnalysis({ projectId: id, ...body }), 202);
  } catch (error) {
    return toErrorResponse(error);
  }
}
