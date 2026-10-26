import "server-only";

import { listClaudeModels, listOpenAiModels } from "@studio/adapters/ai-models";
import { loadRepoEnv } from "@studio/config";

export interface AiProviderCatalogItem {
  id: "claude" | "openai";
  label: string;
  configured: boolean;
  defaultModel: string;
  models: string[];
  warning?: string;
}

export interface AiProviderCatalog {
  providers: AiProviderCatalogItem[];
  loadedAt: string;
}

const TTL_MS = 5 * 60_000;
let cached: { expires: number; value: AiProviderCatalog } | undefined;

export async function getAiProviderCatalog(refresh = false): Promise<AiProviderCatalog> {
  if (!refresh && cached && cached.expires > Date.now()) return cached.value;
  const env = loadRepoEnv();
  const [claude, openai] = await Promise.all([
    env.ANTHROPIC_API_KEY === undefined
      ? Promise.resolve(null)
      : listClaudeModels({
          apiKey: env.ANTHROPIC_API_KEY,
          patterns: env.ANTHROPIC_AI_MODEL_PATTERNS,
          fallback: env.AI_MODEL,
        }),
    env.OPENAI_API_KEY === undefined
      ? Promise.resolve(null)
      : listOpenAiModels({
          apiKey: env.OPENAI_API_KEY,
          patterns: env.OPENAI_AI_MODEL_PATTERNS,
          fallback: env.OPENAI_AI_MODEL,
        }),
  ]);
  const value: AiProviderCatalog = {
    providers: [
      {
        id: "claude",
        label: "Claude",
        configured: claude !== null,
        defaultModel: env.AI_MODEL,
        models: claude?.models ?? [],
        ...(claude?.warning && {
          warning: "Không tải được danh sách model Claude; đang dùng model mặc định.",
        }),
      },
      {
        id: "openai",
        label: "OpenAI",
        configured: openai !== null,
        defaultModel: env.OPENAI_AI_MODEL,
        models: openai?.models ?? [],
        ...(openai?.warning && {
          warning: "Không tải được danh sách model OpenAI; đang dùng model mặc định.",
        }),
      },
    ],
    loadedAt: new Date().toISOString(),
  };
  cached = { expires: Date.now() + TTL_MS, value };
  return value;
}
