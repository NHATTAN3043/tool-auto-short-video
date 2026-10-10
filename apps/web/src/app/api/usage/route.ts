import { getContainer } from "@/server/container";
import { jsonOk, toErrorResponse } from "@/server/http";

/** Spend of the paid APIs per budget window and per project, for the settings page. */
export async function GET() {
  try {
    return jsonOk(await getContainer().getUsageReport());
  } catch (error) {
    return toErrorResponse(error);
  }
}
