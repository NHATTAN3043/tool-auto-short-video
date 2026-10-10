import { getContainer } from "@/server/container";
import { jsonOk, toErrorResponse } from "@/server/http";
import { receiveSingleFile } from "@/server/upload";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Uploads one media file (multipart field of any name) into the project. */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const container = getContainer();
    const result = await receiveSingleFile(request, container.maxUploadBytes, (file) =>
      container.importAsset({ projectId: id, fileName: file.fileName, data: file.data }),
    );
    return jsonOk(result, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
