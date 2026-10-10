import "server-only";

import { DomainError } from "@studio/domain";
import { z } from "zod";

/** Voice services are null without ELEVENLABS_API_KEY; their routes then answer TTS_UNAVAILABLE (404). */
export function requireTts<T>(service: T | null): T {
  if (service === null) throw new DomainError("TTS_UNAVAILABLE", "No TTS provider is configured");
  return service;
}

/** Body of the project voice routes: the scenes to consider (default: every scene). */
export const SceneVoicesBodySchema = z.object({ sceneIds: z.array(z.string().min(1)).min(1).optional() });
