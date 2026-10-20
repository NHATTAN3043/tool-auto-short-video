import { ContentLanguageSchema, VoiceSettingsSchema } from "@studio/domain";
import { z } from "zod";

import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";
import { requireTts } from "@/server/tts";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const PreviewBodySchema = z.object({
  text: z.string(),
  voice: VoiceSettingsSchema,
  language: ContentLanguageSchema,
});

/**
 * Speaks a short sentence with the voice settings shown in the editor (paid, guarded; ADR 0014). Answers
 * the stored file's path below the project, played through /files; the same preview again is free.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const previewVoice = requireTts(getContainer().previewVoice);
    const body = await parseJsonBody(request, PreviewBodySchema);
    return jsonOk(await previewVoice({ projectId: id, ...body }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
