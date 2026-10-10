import { setTimeout as sleep } from "node:timers/promises";

import { createContainer } from "./container";

const IDLE_POLL_MS = 2000;

const container = createContainer();
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.warn(`[worker] ${signal}: finishing the current job, then exiting`);
    controller.abort();
  });
}

const failed = await container.failStaleJobs();
if (failed > 0) console.warn(`[worker] marked ${String(failed)} interrupted job(s) as FAILED`);
console.warn(`[worker] watching ${container.jobSource} for render jobs`);

while (!controller.signal.aborted) {
  try {
    const job = await container.runNextRenderJob();
    if (job) {
      const cost = job.ai?.costUsd === undefined ? "" : ` (${job.ai.costUsd.toFixed(4)} USD)`;
      const done = job.kind === "tts" ? "voices done" : `done → ${job.outputPath ?? ""}${cost}`;
      const outcome = job.status === "COMPLETED" ? done : `failed: ${job.errorMessage ?? ""}`;
      console.warn(`[worker] ${job.id} (${job.projectId}) ${outcome}`);
      continue;
    }
  } catch (error) {
    // A broken queue file, disk or database error must not kill the loop; try again after the idle delay.
    console.error("[worker] error while processing jobs:", error);
  }
  await sleep(IDLE_POLL_MS, undefined, { signal: controller.signal }).catch(() => undefined);
}
await container.close();
