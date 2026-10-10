"use client";

import type { FullAiRequest, RenderJob } from "@studio/domain";
import { useCallback, useEffect, useRef, useState } from "react";

import { estimateFullAi, getFullAiJob, listProjectJobs, requestFullAi, type FullAiEstimate } from "../api";
import { FULL_AI_POLL_INTERVAL_MS, isRunning } from "../model";

const message = (error: unknown) => (error instanceof Error ? error.message : "Đã có lỗi xảy ra.");

export type FullAiState =
  | { step: "idle" }
  | { step: "estimating" }
  /** Waiting for the user to confirm the cost (and the replacement of the current scenes). */
  | { step: "confirm"; request: FullAiRequest; estimate: FullAiEstimate }
  | { step: "running"; job: RenderJob }
  | { step: "error"; message: string };

/**
 * One Full AI run: estimate, confirm, queue, poll. A run still going after a reload is picked up again.
 * `beforeRun` saves the editor first, so the worker starts from what is on screen; `onDone` gets the
 * finished job (the caller opens the review screen).
 */
export function useFullAi(
  projectId: string,
  enabled: boolean,
  beforeRun: () => Promise<void>,
  onDone: (job: RenderJob) => void,
) {
  const [state, setState] = useState<FullAiState>({ step: "idle" });
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    listProjectJobs(projectId)
      .then((jobs) => {
        const running = jobs.find((job) => job.kind === "full_ai" && isRunning(job));
        if (!cancelled && running) setState({ step: "running", job: running });
      })
      .catch(() => {
        // Not fatal: the panel works without knowing older jobs.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);

  const jobId = state.step === "running" ? state.job.id : null;
  useEffect(() => {
    if (jobId === null) return;
    let cancelled = false;
    const stopped = () => cancelled;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const job = await getFullAiJob(projectId, jobId);
          if (stopped()) return;
          if (isRunning(job)) setState({ step: "running", job });
          else if (job.status === "COMPLETED") onDoneRef.current(job);
          else setState({ step: "error", message: job.errorMessage ?? "Full AI không chạy được." });
        } catch (cause) {
          if (!stopped()) setState({ step: "error", message: message(cause) });
        }
      })();
    }, FULL_AI_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `state` changes after every poll, which schedules the next one.
  }, [projectId, jobId, state]);

  const prepare = useCallback(
    async (request: FullAiRequest) => {
      setState({ step: "estimating" });
      try {
        // The estimate does not depend on replacing: ask as if confirmed, the dialog asks the user.
        const estimate = await estimateFullAi(projectId, { ...request, replaceScenes: true });
        setState({ step: "confirm", request, estimate });
      } catch (cause) {
        setState({ step: "error", message: message(cause) });
      }
    },
    [projectId],
  );

  const confirm = useCallback(
    async (replaceScenes: boolean) => {
      if (state.step !== "confirm") return;
      try {
        await beforeRun();
        setState({
          step: "running",
          job: await requestFullAi(projectId, { ...state.request, replaceScenes }),
        });
      } catch (cause) {
        setState({ step: "error", message: message(cause) });
      }
    },
    [projectId, state, beforeRun],
  );

  const reset = useCallback(() => {
    setState({ step: "idle" });
  }, []);

  return { state, prepare, confirm, reset, running: state.step === "running" };
}

export type FullAiController = ReturnType<typeof useFullAi>;
