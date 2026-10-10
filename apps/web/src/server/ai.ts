import "server-only";

import { AiTaskSchema, DomainError, FullAiRequestSchema } from "@studio/domain";
import { z } from "zod";

/** AI services are null without ANTHROPIC_API_KEY; their routes then answer AI_UNAVAILABLE (404). */
export function requireAi<T>(service: T | null): T {
  if (service === null) throw new DomainError("AI_UNAVAILABLE", "No AI provider is configured");
  return service;
}

/** Body of the AI estimate and job routes. */
export const AiTaskBodySchema = z.object({ task: AiTaskSchema });

/** Body of the Full AI estimate and job routes. */
export const FullAiBodySchema = z.object({ request: FullAiRequestSchema });
