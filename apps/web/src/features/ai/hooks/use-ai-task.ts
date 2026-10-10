"use client";

import type { AiResult, AiTask, RenderJob } from "@studio/domain";
import { useCallback, useEffect, useState } from "react";

import { estimateAi, getAiJob, getAiResult, requestAi, type AiEstimate } from "../api";
import { AI_POLL_INTERVAL_MS } from "../model";

const message = (error: unknown) => (error instanceof Error ? error.message : "Đã có lỗi xảy ra.");

export type AiTaskState =
  | { step: "idle" }
  | { step: "estimating" }
  /** Waiting for the user to confirm the cost. */
  | { step: "confirm"; task: AiTask; estimate: AiEstimate }
  | { step: "running"; job: RenderJob }
  /** A suggestion to review; nothing is applied yet. */
  | { step: "review"; result: AiResult }
  | { step: "error"; message: string };

/**
 * One AI task from estimate to suggestion: estimate the cost, wait for confirmation, queue a worker job,
 * poll it, then fetch the suggestion for review. Applying it is up to the caller.
 */
export function useAiTask(projectId: string) {
  const [state, setState] = useState<AiTaskState>({ step: "idle" });

  const jobId = state.step === "running" ? state.job.id : null;
  useEffect(() => {
    if (jobId === null) return;
    let cancelled = false;
    const stopped = () => cancelled;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const job = await getAiJob(projectId, jobId);
          if (stopped()) return;
          if (job.status === "QUEUED" || job.status === "PROCESSING") {
            setState({ step: "running", job });
          } else if (job.status === "COMPLETED") {
            const result = await getAiResult(projectId, jobId);
            if (!stopped()) setState({ step: "review", result });
          } else {
            setState({ step: "error", message: job.errorMessage ?? "AI không chạy được." });
          }
        } catch (cause) {
          if (!stopped()) setState({ step: "error", message: message(cause) });
        }
      })();
    }, AI_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `state` changes after every poll, which schedules the next one.
  }, [projectId, jobId, state]);

  const prepare = useCallback(
    async (task: AiTask) => {
      setState({ step: "estimating" });
      try {
        setState({ step: "confirm", task, estimate: await estimateAi(projectId, task) });
      } catch (cause) {
        setState({ step: "error", message: message(cause) });
      }
    },
    [projectId],
  );

  const confirm = useCallback(async () => {
    if (state.step !== "confirm") return;
    try {
      setState({ step: "running", job: await requestAi(projectId, state.task) });
    } catch (cause) {
      setState({ step: "error", message: message(cause) });
    }
  }, [projectId, state]);

  const reset = useCallback(() => {
    setState({ step: "idle" });
  }, []);

  return { state, prepare, confirm, reset, busy: state.step === "estimating" || state.step === "running" };
}

export type AiTaskController = ReturnType<typeof useAiTask>;
