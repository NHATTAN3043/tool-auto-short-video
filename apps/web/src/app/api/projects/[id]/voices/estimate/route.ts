import { getContainer } from "@/server/container";
import { jsonOk, parseOptionalJsonBody, toErrorResponse } from "@/server/http";
import { requireTts, SceneVoicesBodySchema } from "@/server/tts";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Estimated cost of generating the changed voices, shown before the user confirms. No paid call. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const estimateSceneVoices = requireTts(getContainer().estimateSceneVoices);
    const { sceneIds, regenerate } = await parseOptionalJsonBody(request, SceneVoicesBodySchema, {});
    return jsonOk(
      await estimateSceneVoices({
        projectId: id,
        ...(sceneIds && { sceneIds }),
        ...(regenerate && { regenerate }),
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
