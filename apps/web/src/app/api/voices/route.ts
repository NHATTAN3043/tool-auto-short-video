import { getContainer } from "@/server/container";
import { jsonOk, toErrorResponse } from "@/server/http";
import { requireTts } from "@/server/tts";

/** Voices and models of the TTS provider, plus the preselected defaults. 404 when TTS is not configured. */
export async function GET() {
  try {
    const container = getContainer();
    const catalog = await requireTts(container.listTtsVoices)();
    return jsonOk({ ...catalog, defaults: container.voiceDefaults });
  } catch (error) {
    return toErrorResponse(error);
  }
}
