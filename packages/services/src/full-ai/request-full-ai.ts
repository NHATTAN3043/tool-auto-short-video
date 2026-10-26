import { budgetExceededMessage, DomainError, newId, type IdGenerator, type RenderJob } from "@studio/domain";

import type { Clock } from "../ports/clock";
import type { JobQueuePort } from "../ports/job-queue";
import { KeyedLock } from "../shared/keyed-lock";
import { makeEstimateFullAi, type FullAiDeps, type FullAiInput } from "./estimate-full-ai";

const ACTIVE = new Set<RenderJob["status"]>(["QUEUED", "PROCESSING"]);

/**
 * Queues a Full AI run for the worker after checking the request and the budgets. A project runs one
 * Full AI job at a time: asking again returns the one already waiting or running.
 */
export function makeRequestFullAi(
  deps: FullAiDeps & { queue: JobQueuePort; clock: Clock; newId?: IdGenerator },
) {
  const estimate = makeEstimateFullAi(deps);
  const lock = new KeyedLock();
  return (input: FullAiInput): Promise<RenderJob> =>
    lock.run(input.projectId, async () => {
      const jobs = await deps.queue.list({ projectId: input.projectId });
      const running = jobs.find((job) => job.kind === "full_ai" && ACTIVE.has(job.status));
      if (running) return running;

      const cost = await estimate(input);
      const project = await deps.repo.get(input.projectId);
      const selectedAi = deps.resolveAi?.(project.ai) ?? deps.ai;
      const config = project.ai ?? {
        provider: selectedAi.id === "openai" ? ("openai" as const) : ("claude" as const),
        model: selectedAi.model,
      };
      const blocked = budgetExceededMessage(cost.budget);
      if (blocked !== null) throw new DomainError("BUDGET_EXCEEDED", blocked);
      return deps.queue.enqueue({
        id: (deps.newId ?? newId)("job"),
        projectId: input.projectId,
        kind: "full_ai",
        fullAi: { request: input.request, steps: cost.steps, config, maxUsd: cost.maxUsd },
        status: "QUEUED",
        progress: 0,
        createdAt: deps.clock.now(),
      });
    });
}
