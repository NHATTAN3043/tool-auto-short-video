import { getContainer } from "@/server/container";
import { jsonOk, parseOptionalJsonBody, toErrorResponse } from "@/server/http";
import { SceneVoicesBodySchema } from "@/server/tts";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Queues the free loudness job for the saved project's AI voices that are not balanced yet; the worker runs
 * it with ffmpeg. 202: accepted, poll the job through /renders/:jobId.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { sceneIds } = await parseOptionalJsonBody(request, SceneVoicesBodySchema, {});
    return jsonOk(
      await getContainer().requestVoiceLoudness({ projectId: id, ...(sceneIds && { sceneIds }) }),
      202,
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
