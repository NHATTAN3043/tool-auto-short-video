import { getContainer } from "@/server/container";
import { jsonOk, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string; jobId: string }>;
}

/** Ranked candidates and warnings of a finished Full AI run, for the review screen. */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id, jobId } = await params;
    return jsonOk(await getContainer().getFullAiResult({ projectId: id, jobId }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
