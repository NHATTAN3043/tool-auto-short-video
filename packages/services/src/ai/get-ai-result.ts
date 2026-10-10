import { AiResultSchema, DomainError, type AiResult } from "@studio/domain";

import type { JobQueuePort } from "../ports/job-queue";
import type { StoragePort } from "../ports/storage";

/** The suggestion of a finished AI job, for the user to review. */
export function makeGetAiResult(deps: { queue: JobQueuePort; storage: StoragePort }) {
  return async (input: { projectId: string; jobId: string }): Promise<AiResult> => {
    const job = await deps.queue.get(input.jobId);
    if (job.projectId !== input.projectId || job.kind !== "ai") {
      throw new DomainError("JOB_NOT_FOUND", `AI job not found: ${input.jobId}`);
    }
    if (job.status !== "COMPLETED" || job.outputPath === undefined) {
      throw new DomainError("INVALID_OPERATION", `AI job ${job.id} has no result (${job.status})`);
    }
    const key = `projects/${job.projectId}/${job.outputPath}`;
    if (!(await deps.storage.exists(key))) throw new DomainError("FILE_NOT_FOUND", `Missing ${key}`);
    let text = "";
    const decoder = new TextDecoder();
    for await (const chunk of deps.storage.read(key)) text += decoder.decode(chunk, { stream: true });
    text += decoder.decode();
    return AiResultSchema.parse(JSON.parse(text));
  };
}
