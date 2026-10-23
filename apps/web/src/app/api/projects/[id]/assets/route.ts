import { z } from "zod";

import { getContainer } from "@/server/container";
import { jsonOk, toErrorResponse } from "@/server/http";
import { receiveSingleFile } from "@/server/upload";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** `?library=0` keeps a video out of the shared library; anything else leaves the default (copy it). */
const QuerySchema = z.object({ library: z.enum(["0", "1"]).optional() });

/** Uploads one media file (multipart field of any name) into the project. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const query = QuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const container = getContainer();
    const result = await receiveSingleFile(request, container.maxUploadBytes, (file) =>
      container.importAsset({
        projectId: id,
        fileName: file.fileName,
        data: file.data,
        addToLibrary: query.library !== "0",
      }),
    );
    return jsonOk(result, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
