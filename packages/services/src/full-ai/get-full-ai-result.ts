import { DomainError, FullAiResultSchema, type FullAiResult, type RenderJob } from "@studio/domain";

import type { JobQueuePort } from "../ports/job-queue";
import type { StoragePort } from "../ports/storage";

async function readResult(storage: StoragePort, job: RenderJob): Promise<FullAiResult> {
  const key = `projects/${job.projectId}/${job.outputPath ?? ""}`;
  if (job.outputPath === undefined || !(await storage.exists(key))) {
    throw new DomainError("FILE_NOT_FOUND", `Missing result of ${job.id}`);
  }
  let text = "";
  const decoder = new TextDecoder();
  for await (const chunk of storage.read(key)) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  return FullAiResultSchema.parse(JSON.parse(text));
}

/** Ranked candidates and warnings of a finished Full AI job, for the review screen. */
export function makeGetFullAiResult(deps: { queue: JobQueuePort; storage: StoragePort }) {
  return async (input: { projectId: string; jobId: string }): Promise<FullAiResult> => {
    const job = await deps.queue.get(input.jobId);
    if (job.projectId !== input.projectId || job.kind !== "full_ai") {
      throw new DomainError("JOB_NOT_FOUND", `Full AI job not found: ${input.jobId}`);
    }
    if (job.status !== "COMPLETED") {
      throw new DomainError("INVALID_OPERATION", `Full AI job ${job.id} has no result (${job.status})`);
    }
    return readResult(deps.storage, job);
  };
}

/** The newest Full AI job of a project and, once it finished, its result; null when there is none. */
export function makeGetLatestFullAi(deps: { queue: JobQueuePort; storage: StoragePort }) {
  return async (projectId: string): Promise<{ job: RenderJob; result: FullAiResult | null } | null> => {
    const jobs = await deps.queue.list({ projectId });
    const job = jobs.filter((candidate) => candidate.kind === "full_ai").at(-1);
    if (!job) return null;
    if (job.status !== "COMPLETED") return { job, result: null };
    // A result file that went missing should not break the review screen.
    return { job, result: await readResult(deps.storage, job).catch(() => null) };
  };
}
