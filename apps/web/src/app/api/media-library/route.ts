import { getContainer } from "@/server/container";
import { jsonOk, toErrorResponse } from "@/server/http";

/** The shared media library, newest first. */
export async function GET() {
  try {
    return jsonOk(await getContainer().listLibraryMedia());
  } catch (error) {
    return toErrorResponse(error);
  }
}
