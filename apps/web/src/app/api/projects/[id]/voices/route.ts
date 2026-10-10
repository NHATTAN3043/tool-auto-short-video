import { getContainer } from "@/server/container";
import { jsonOk, parseOptionalJsonBody, toErrorResponse } from "@/server/http";
import { requireTts, SceneVoicesBodySchema } from "@/server/tts";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Queues voice generation for the saved project's scenes whose voice is missing or outdated; the worker
 * runs it. 202: accepted, poll the job through /renders/:jobId.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const requestSceneVoices = requireTts(getContainer().requestSceneVoices);
    const { sceneIds } = await parseOptionalJsonBody(request, SceneVoicesBodySchema, {});
    return jsonOk(await requestSceneVoices({ projectId: id, ...(sceneIds && { sceneIds }) }), 202);
  } catch (error) {
    return toErrorResponse(error);
  }
}
