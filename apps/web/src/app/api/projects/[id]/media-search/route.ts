import { MediaSearchQuerySchema } from "@studio/domain";

import { getContainer } from "@/server/container";
import { jsonOk, toErrorResponse } from "@/server/http";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** `?q=&kind=video|image&lang=en|vi|zh&sources=library,pexels,pixabay`: shared library first, then stock. */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const search = new URL(request.url).searchParams;
    const sources = search.get("sources");
    const query = MediaSearchQuerySchema.parse({
      query: search.get("q") ?? "",
      kind: search.get("kind") ?? "video",
      lang: search.get("lang") ?? undefined,
      sources: sources === null || sources === "" ? undefined : sources.split(","),
    });
    return jsonOk(await getContainer().searchMedia({ projectId: id, query }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
