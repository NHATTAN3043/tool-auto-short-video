import { budgetExceededMessage, DomainError, newId, type IdGenerator, type RenderJob } from "@studio/domain";

import type { Clock } from "../ports/clock";
import type { CostGuardPort } from "../ports/cost-guard";
import type { JobQueuePort } from "../ports/job-queue";
import type { ProjectRepository } from "../ports/project-repository";
import type { TtsPort } from "../ports/tts";
import { KeyedLock } from "../shared/keyed-lock";
import { makeEstimateSceneVoices, type SceneVoicesInput } from "./estimate-scene-voices";

const ACTIVE = new Set<RenderJob["status"]>(["QUEUED", "PROCESSING"]);

/**
 * Queues a `tts` job for the requested scenes whose voice is missing or outdated (with `regenerate`: every
 * requested scene with narration); the worker generates them. Asking again for scenes an active job already covers returns that job instead of paying twice.
 * A batch that would break a budget is refused here; the worker's CostGuard checks each scene again.
 */
export function makeRequestSceneVoices(deps: {
  repo: ProjectRepository;
  queue: JobQueuePort;
  tts: TtsPort;
  costGuard: CostGuardPort;
  clock: Clock;
  newId?: IdGenerator;
}) {
  const estimate = makeEstimateSceneVoices(deps);
  const lock = new KeyedLock();
  return (input: SceneVoicesInput): Promise<RenderJob> =>
    lock.run(input.projectId, async () => {
      const { sceneIds, budget } = await estimate(input);
      if (sceneIds.length === 0) {
        throw new DomainError("INVALID_OPERATION", "No scene needs a new voice");
      }

      const jobs = await deps.queue.list({ projectId: input.projectId });
      const regenerate = input.regenerate === true;
      // A running job only stands in for this request when it does the same kind of run.
      const covering = jobs.find(
        (job) =>
          job.kind === "tts" &&
          ACTIVE.has(job.status) &&
          job.voice?.normalizeOnly !== true &&
          (job.voice?.regenerate === true) === regenerate &&
          sceneIds.every((id) => job.sceneIds?.includes(id) === true),
      );
      if (covering) return covering;

      const blocked = budgetExceededMessage(budget);
      if (blocked !== null) throw new DomainError("BUDGET_EXCEEDED", blocked);
      return deps.queue.enqueue({
        id: (deps.newId ?? newId)("job"),
        projectId: input.projectId,
        kind: "tts",
        sceneIds,
        ...(regenerate && { voice: { regenerate: true } }),
        status: "QUEUED",
        progress: 0,
        createdAt: deps.clock.now(),
      });
    });
}
