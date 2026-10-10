import {
  buildRenderPlan,
  DomainError,
  newId,
  type IdGenerator,
  type RenderJob,
  type RenderJobKind,
} from "@studio/domain";

import type { Clock } from "../ports/clock";
import type { JobQueuePort } from "../ports/job-queue";
import type { ProjectRepository } from "../ports/project-repository";
import { KeyedLock } from "../shared/keyed-lock";

const ACTIVE = new Set<RenderJob["status"]>(["QUEUED", "PROCESSING"]);

/**
 * Queues a render; the worker does the actual work. Never renders inside the request. While a job of the
 * same kind is queued or running for the project, asking again returns that job instead of a duplicate.
 */
export function makeRequestRender(deps: {
  repo: ProjectRepository;
  queue: JobQueuePort;
  clock: Clock;
  newId?: IdGenerator;
}) {
  const lock = new KeyedLock();
  return (input: {
    projectId: string;
    kind?: Extract<RenderJobKind, "video" | "capcut">;
  }): Promise<RenderJob> =>
    lock.run(input.projectId, async () => {
      const project = await deps.repo.get(input.projectId);
      if (project.scenes.length === 0) {
        throw new DomainError("INVALID_OPERATION", "The project has no scenes to render");
      }
      // Fails fast on broken asset references instead of failing later in the worker.
      buildRenderPlan(project, (asset) => asset.path);

      const jobs = await deps.queue.list({ projectId: project.id });
      const kind = input.kind ?? "video";
      const active = jobs.find((job) => ACTIVE.has(job.status) && (job.kind ?? "video") === kind);
      if (active) return active;

      return deps.queue.enqueue({
        id: (deps.newId ?? newId)("job"),
        projectId: project.id,
        ...(kind === "capcut" && { kind }),
        status: "QUEUED",
        progress: 0,
        createdAt: deps.clock.now(),
      });
    });
}
