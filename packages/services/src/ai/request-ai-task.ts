import {
  budgetExceededMessage,
  DomainError,
  newId,
  withProjectLanguage,
  type IdGenerator,
  type RenderJob,
} from "@studio/domain";

import { KeyedLock } from "../shared/keyed-lock";
import { makeEstimateAiTask, type AiTaskDeps, type AiTaskInput } from "./estimate-ai-task";

const ACTIVE = new Set<RenderJob["status"]>(["QUEUED", "PROCESSING"]);

/**
 * Queues an AI task for the worker after checking its toggle and the budgets, so the user is told at once.
 * The worker's CostGuard checks again right before the paid call, because other jobs may run first.
 * The same task already waiting or running is returned instead. The task is queued with the project
 * language filled in (ADR 0013), whatever the browser sent.
 */
export function makeRequestAiTask(deps: AiTaskDeps & { newId?: IdGenerator }) {
  const estimate = makeEstimateAiTask(deps);
  const lock = new KeyedLock();
  return (input: AiTaskInput): Promise<RenderJob> =>
    lock.run(input.projectId, async () => {
      const task = withProjectLanguage(input.task, await deps.repo.get(input.projectId));
      const cost = await estimate({ projectId: input.projectId, task });
      const sameTask = JSON.stringify(task);
      const jobs = await deps.queue.list({ projectId: input.projectId });
      const running = jobs.find(
        (job) => job.kind === "ai" && ACTIVE.has(job.status) && JSON.stringify(job.ai?.task) === sameTask,
      );
      if (running) return running;
      const blocked = budgetExceededMessage(cost.budget);
      if (blocked !== null) throw new DomainError("BUDGET_EXCEEDED", blocked);
      return deps.queue.enqueue({
        id: (deps.newId ?? newId)("job"),
        projectId: input.projectId,
        kind: "ai",
        ai: { task, maxUsd: cost.maxUsd },
        status: "QUEUED",
        progress: 0,
        createdAt: deps.clock.now(),
      });
    });
}
