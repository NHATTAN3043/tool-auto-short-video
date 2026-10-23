import { ClipAnalysisBodySchema, requireAi } from "@/server/ai";
import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** What analyzing these shared library videos would cost, and whether the budgets allow it. No paid call. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const estimate = requireAi(getContainer().estimateClipAnalysis);
    const body = await parseJsonBody(request, ClipAnalysisBodySchema);
    return jsonOk(await estimate({ projectId: id, ...body }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
