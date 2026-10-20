import { getContainer } from "@/server/container";
import { toErrorResponse } from "@/server/http";
import { requireTts } from "@/server/tts";

interface RouteContext {
  params: Promise<{ voiceId: string }>;
}

/** The provider's free recorded sample of a voice, fetched by the server so the browser never calls it. */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { voiceId } = await params;
    const sample = await requireTts(getContainer().getVoiceSample)(voiceId);
    return new Response(new Uint8Array(sample.audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(sample.audio.length),
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
