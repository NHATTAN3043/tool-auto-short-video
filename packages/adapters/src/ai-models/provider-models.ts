import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface ProviderModelsResult {
  models: string[];
  warning?: string;
}

/** Small, safe glob matcher: only `*` is special; every other character is literal. */
export function matchesModelPatterns(model: string, source: string): boolean {
  const patterns = source
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return patterns.some((pattern) => {
    const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&").replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`, "u").test(model);
  });
}

function filtered(ids: readonly string[], patterns: string, fallback: string): string[] {
  const models = [...new Set(ids.filter((id) => matchesModelPatterns(id, patterns)))].sort();
  if (!models.includes(fallback)) models.unshift(fallback);
  return models;
}

export async function listClaudeModels(options: {
  apiKey: string;
  patterns: string;
  fallback: string;
}): Promise<ProviderModelsResult> {
  try {
    const page = await new Anthropic({ apiKey: options.apiKey, maxRetries: 0 }).models.list({ limit: 1000 });
    return {
      models: filtered(
        page.data.map((model) => model.id),
        options.patterns,
        options.fallback,
      ),
    };
  } catch (error) {
    return { models: [options.fallback], warning: error instanceof Error ? error.message : String(error) };
  }
}

export async function listOpenAiModels(options: {
  apiKey: string;
  patterns: string;
  fallback: string;
}): Promise<ProviderModelsResult> {
  try {
    const page = await new OpenAI({ apiKey: options.apiKey, maxRetries: 0 }).models.list();
    return {
      models: filtered(
        page.data.map((model) => model.id),
        options.patterns,
        options.fallback,
      ),
    };
  } catch (error) {
    return { models: [options.fallback], warning: error instanceof Error ? error.message : String(error) };
  }
}
