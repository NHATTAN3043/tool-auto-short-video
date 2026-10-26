import { z } from "zod";

export const AiProviderSchema = z.enum(["claude", "openai"]);
export type AiProvider = z.infer<typeof AiProviderSchema>;

/** Provider and model used by a project or snapshotted onto a queued AI job. */
export const AiConfigSchema = z.object({
  provider: AiProviderSchema,
  model: z.string().trim().min(1).max(200),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;
