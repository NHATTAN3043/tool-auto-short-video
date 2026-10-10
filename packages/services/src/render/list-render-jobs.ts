import { DomainError, type RenderJob } from "@studio/domain";

import type { JobQueuePort } from "../ports/job-queue";
import type { ProjectRepository } from "../ports/project-repository";

/** Render history of one project, newest first. */
export function makeListRenderJobs(deps: { repo: ProjectRepository; queue: JobQueuePort }) {
  return async (input: { projectId: string }): Promise<RenderJob[]> => {
    await deps.repo.get(input.projectId);
    const jobs = await deps.queue.list({ projectId: input.projectId });
    return jobs.reverse();
  };
}

/** One render job, polled by the UI. A job of another project is reported as not found. */
export function makeGetRenderJob(deps: { queue: JobQueuePort }) {
  return async (input: { projectId: string; jobId: string }): Promise<RenderJob> => {
    const job = await deps.queue.get(input.jobId);
    if (job.projectId !== input.projectId) {
      throw new DomainError("JOB_NOT_FOUND", `Job ${input.jobId} is not part of ${input.projectId}`);
    }
    return job;
  };
}
