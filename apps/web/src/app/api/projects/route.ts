import { CreateProjectInputSchema } from "@studio/domain";

import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

export async function GET() {
  try {
    return jsonOk(await getContainer().listProjects());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseJsonBody(request, CreateProjectInputSchema);
    return jsonOk(await getContainer().createProject(input), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
