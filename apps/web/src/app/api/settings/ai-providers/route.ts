import { getAiProviderCatalog } from "@/server/ai-provider-catalog";
import { jsonOk, toErrorResponse } from "@/server/http";

export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    return jsonOk(await getAiProviderCatalog(refresh));
  } catch (error) {
    return toErrorResponse(error);
  }
}
