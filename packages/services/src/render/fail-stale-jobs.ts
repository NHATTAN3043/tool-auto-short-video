import type { Clock } from "../ports/clock";
import type { JobQueuePort } from "../ports/job-queue";

export const STALE_JOB_MESSAGE = "The worker stopped before this render finished. Please render again.";

/**
 * Run once when the worker starts: a job still PROCESSING belongs to a worker that died, and would
 * otherwise stay stuck forever.
 */
export function makeFailStaleJobs(deps: { queue: JobQueuePort; clock: Clock }) {
  return async (): Promise<number> => {
    const stale = await deps.queue.list({ status: "PROCESSING" });
    for (const job of stale) {
      await deps.queue.update(job.id, {
        status: "FAILED",
        errorMessage: STALE_JOB_MESSAGE,
        completedAt: deps.clock.now(),
      });
    }
    return stale.length;
  };
}
