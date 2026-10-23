"use client";

import type { RenderJob } from "@studio/domain";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  estimateClipAnalysis,
  getClipJob,
  requestClipAnalysis,
  type ClipAnalysisBody,
  type ClipAnalysisEstimate,
} from "../api";
import { CLIP_POLL_INTERVAL_MS } from "../model";

export type ClipAnalysisState =
  | { step: "idle" }
  | { step: "estimating"; body: ClipAnalysisBody }
  | { step: "confirm"; body: ClipAnalysisBody; estimate: ClipAnalysisEstimate }
  | { step: "requesting"; body: ClipAnalysisBody; estimate: ClipAnalysisEstimate }
  | { step: "job"; job: RenderJob };

const message = (error: unknown) => (error instanceof Error ? error.message : "Đã có lỗi xảy ra.");

/**
 * Estimate → confirm → queue → follow the job until it ends. `onFinished` runs once per finished job, so the
 * panel can reload the library and show the shots.
 */
export function useClipAnalysis(projectId: string, onFinished: () => void) {
  const [state, setState] = useState<ClipAnalysisState>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const estimate = useCallback(
    (body: ClipAnalysisBody) => {
      setError(null);
      setState({ step: "estimating", body });
      estimateClipAnalysis(projectId, body).then(
        (result) => {
          setState({ step: "confirm", body, estimate: result });
        },
        (cause: unknown) => {
          setError(message(cause));
          setState({ step: "idle" });
        },
      );
    },
    [projectId],
  );

  const confirm = useCallback(() => {
    if (state.step !== "confirm") return;
    const { body, estimate: cost } = state;
    setState({ step: "requesting", body, estimate: cost });
    requestClipAnalysis(projectId, body).then(
      (job) => {
        setState({ step: "job", job });
      },
      (cause: unknown) => {
        setError(message(cause));
        setState({ step: "idle" });
      },
    );
  }, [projectId, state]);

  const reset = useCallback(() => {
    setState({ step: "idle" });
  }, []);

  // Follows the job while it is queued or running; stops on its own once it ends.
  const job = state.step === "job" ? state.job : null;
  const jobId = job?.id;
  const running = job?.status === "QUEUED" || job?.status === "PROCESSING";
  useEffect(() => {
    if (jobId === undefined || !running) return;
    const timer = setInterval(() => {
      getClipJob(projectId, jobId).then(
        (next) => {
          setState((current) =>
            current.step === "job" && current.job.id === next.id ? { step: "job", job: next } : current,
          );
          if (next.status !== "QUEUED" && next.status !== "PROCESSING") onFinishedRef.current();
        },
        (cause: unknown) => {
          setError(message(cause));
        },
      );
    }, CLIP_POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [projectId, jobId, running]);

  return { state, error, estimate, confirm, reset };
}

export type ClipAnalysisController = ReturnType<typeof useClipAnalysis>;
