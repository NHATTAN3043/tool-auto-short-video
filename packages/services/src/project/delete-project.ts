import { DomainError } from "@studio/domain";

import type { JobQueuePort } from "../ports/job-queue";
import type { ProjectRepository } from "../ports/project-repository";
import type { StoragePort } from "../ports/storage";

/**
 * Deletes a project for good: its record, its jobs and every file under `projects/<id>/`. Refused while a
 * job of the project is queued or running, because the worker would write files back into the folder.
 * The shared libraries and the API usage log are kept: spend stays counted in the budgets (ADR 0009).
 */
export function makeDeleteProject(deps: {
  repo: ProjectRepository;
  queue: JobQueuePort;
  storage: StoragePort;
}) {
  return async (id: string): Promise<void> => {
    const project = await deps.repo.get(id);
    const jobs = await deps.queue.list({ projectId: project.id });
    if (jobs.some((job) => job.status === "QUEUED" || job.status === "PROCESSING")) {
      throw new DomainError("PROJECT_BUSY", `Project ${project.id} has a queued or running job`);
    }
    // The record goes first: once it is gone the project is no longer listed, even if a file stays behind.
    await deps.repo.remove(project.id);
    await deps.queue.removeForProject(project.id);
    await deps.storage.removeFolder(`projects/${project.id}`);
  };
}
