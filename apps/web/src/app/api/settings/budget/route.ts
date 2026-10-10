import { BudgetLimitsSchema } from "@studio/domain";
import { z } from "zod";

import { getContainer } from "@/server/container";
import { jsonOk, parseJsonBody, toErrorResponse } from "@/server/http";

/** The budgets in force, and the environment defaults they replace. */
export async function GET() {
  try {
    return jsonOk(await getContainer().getBudgetSettings());
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Saves the budgets; the next paid call is checked against them. */
export async function PUT(request: Request) {
  try {
    const { limits } = await parseJsonBody(request, z.object({ limits: BudgetLimitsSchema }));
    const container = getContainer();
    await container.saveBudgetSettings(limits);
    return jsonOk(await container.getBudgetSettings());
  } catch (error) {
    return toErrorResponse(error);
  }
}
