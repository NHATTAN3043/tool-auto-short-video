import { AiConfigSchema, DomainError } from "@studio/domain";
import { z } from "zod";

import { getContainer } from "@/server/container";
import { getAiProviderCatalog } from "@/server/ai-provider-catalog";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    return jsonOk(await getContainer().getProject(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    // Full validation happens in saveProject; here we only guard the URL/body id pairing.
    const body = await parseJsonBody(request, z.looseObject({ id: z.string() }));
    if (body.id !== id) throw new DomainError("INVALID_INPUT", "Project id in the URL and body differ");
    if (body.ai !== undefined) {
      const config = AiConfigSchema.parse(body.ai);
      const provider = (await getAiProviderCatalog()).providers.find((item) => item.id === config.provider);
      if (!provider?.configured || !provider.models.includes(config.model)) {
        throw new DomainError("INVALID_INPUT", "AI provider or model is not configured");
      }
    }
    return jsonOk(await getContainer().saveProject(body));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    await getContainer().deleteProject(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
