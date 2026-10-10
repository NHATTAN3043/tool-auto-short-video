import { getContainer } from "@/server/container";
import { jsonOk, toErrorResponse } from "@/server/http";
import { receiveSingleFile } from "@/server/upload";

/** The shared sound effect library, newest first. */
export async function GET() {
  try {
    return jsonOk(await getContainer().listLibrarySfx());
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Uploads one audio file (multipart field of any name) into the library. */
export async function POST(request: Request) {
  try {
    const container = getContainer();
    const item = await receiveSingleFile(request, container.maxUploadBytes, (file) =>
      container.importLibrarySfx({ fileName: file.fileName, data: file.data }),
    );
    return jsonOk(item, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
