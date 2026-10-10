import type { RenderJob, RenderJobStatus } from "@studio/domain";

export interface JobFilter {
  projectId?: string;
  status?: RenderJobStatus;
}

export type RenderJobPatch = Partial<Omit<RenderJob, "id" | "projectId" | "createdAt">>;

export interface JobQueuePort {
  enqueue(job: RenderJob): Promise<RenderJob>;
  /** Throws DomainError JOB_NOT_FOUND. */
  get(id: string): Promise<RenderJob>;
  /** Oldest first. */
  list(filter?: JobFilter): Promise<RenderJob[]>;
  /** Moves the oldest QUEUED job to PROCESSING and returns it, or null when the queue is empty. */
  claimNext(): Promise<RenderJob | null>;
  update(id: string, patch: RenderJobPatch): Promise<RenderJob>;
  /** Deletes every job of a deleted project; no-op when there is none. */
  removeForProject(projectId: string): Promise<void>;
}
