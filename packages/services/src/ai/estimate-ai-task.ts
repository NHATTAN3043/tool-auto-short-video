import { assertAiTaskAllowed, withProjectLanguage, type AiTask, type BudgetCheck } from "@studio/domain";

import type { AiEstimate, AiPort, AiResolver } from "../ports/ai";
import type { Clock } from "../ports/clock";
import type { CostGuardPort } from "../ports/cost-guard";
import type { JobQueuePort } from "../ports/job-queue";
import type { ProjectRepository } from "../ports/project-repository";
import type { SkillCatalogPort } from "../ports/skill-catalog";
import { resolveSkill, taskLanguage, taskSkillId } from "../skill/skills";

export interface AiTaskDeps {
  repo: ProjectRepository;
  ai: AiPort;
  /** Multi-provider composition roots resolve the project's provider/model here. */
  resolveAi?: AiResolver;
  queue: JobQueuePort;
  clock: Clock;
  costGuard: CostGuardPort;
  /** Installed skills; without it a task naming a skill is refused. */
  skills?: SkillCatalogPort;
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
export function makeEstimateAiTask(
  deps: Pick<AiTaskDeps, "repo" | "ai" | "resolveAi" | "costGuard" | "skills">,
) {
  return async (input: AiTaskInput): Promise<AiTaskEstimate> => {
    const project = await deps.repo.get(input.projectId);
    assertAiTaskAllowed(project, input.task);
    const task = withProjectLanguage(input.task, project);
    const guidance = await resolveSkill(deps.skills ?? null, taskSkillId(task), taskLanguage(task));
    const ai = deps.resolveAi?.(project.ai) ?? deps.ai;
    const estimate = await ai.estimate(task, guidance);
    const budget = await deps.costGuard.check({
      projectId: project.id,
      totalUsd: estimate.maxUsd,
      maxCallUsd: estimate.maxUsd,
    });
    return { ...estimate, model: ai.model, budget };
  };
}
