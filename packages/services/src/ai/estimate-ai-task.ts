import { assertAiTaskAllowed, type AiTask, type BudgetCheck } from "@studio/domain";

import type { AiEstimate, AiPort } from "../ports/ai";
import type { Clock } from "../ports/clock";
import type { CostGuardPort } from "../ports/cost-guard";
import type { JobQueuePort } from "../ports/job-queue";
import type { ProjectRepository } from "../ports/project-repository";

export interface AiTaskDeps {
  repo: ProjectRepository;
  ai: AiPort;
  queue: JobQueuePort;
  clock: Clock;
  costGuard: CostGuardPort;
}

export interface AiTaskInput {
  projectId: string;
  task: AiTask;
}

export interface AiTaskEstimate extends AiEstimate {
  model: string;
  /** Whether the worst case of this call fits every budget, and what was already spent. */
  budget: BudgetCheck;
}

/** What one AI task would cost and whether the budgets allow it. Makes no paid call. */
export function makeEstimateAiTask(deps: Pick<AiTaskDeps, "repo" | "ai" | "costGuard">) {
  return async (input: AiTaskInput): Promise<AiTaskEstimate> => {
    const project = await deps.repo.get(input.projectId);
    assertAiTaskAllowed(project, input.task.type);
    const estimate = await deps.ai.estimate(input.task);
    const budget = await deps.costGuard.check({
      projectId: project.id,
      totalUsd: estimate.maxUsd,
      maxCallUsd: estimate.maxUsd,
    });
    return { ...estimate, model: deps.ai.model, budget };
  };
}
