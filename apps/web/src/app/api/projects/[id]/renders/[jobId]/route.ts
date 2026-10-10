import { getContainer } from "@/server/container";
import { jsonOk, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string; jobId: string }>;
}

/** One render job; the UI polls this while the worker renders. */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id, jobId } = await params;
    return jsonOk(await getContainer().getRenderJob({ projectId: id, jobId }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
