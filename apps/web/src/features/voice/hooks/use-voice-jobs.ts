"use client";

import type { Project, RenderJob } from "@studio/domain";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  estimateVoices,
  fetchProject,
  getJob,
  listJobs,
  requestVoiceLoudness,
  requestVoices,
  type VoiceEstimate,
} from "../api";
import { isRunning, isVoiceJob, VOICE_POLL_INTERVAL_MS } from "../model";

const message = (error: unknown) => (error instanceof Error ? error.message : "Đã có lỗi xảy ra.");

export interface PendingVoiceRun {
  /** Undefined: every scene that needs a voice. */
  sceneIds?: readonly string[];
  /** New take of voices that still match their narration. */
  regenerate: boolean;
  estimate: VoiceEstimate;
}

/**
 * Voice generation of the project: estimate the cost, then (after the user confirms) queue a worker job
 * and poll it. When the job ends, the stored project is fetched and its new voices are handed to
 * `onFinished`, so the editor merges them into its own copy instead of overwriting them on autosave.
 */
export function useVoiceJobs(
  projectId: string,
  enabled: boolean,
  flushSave: () => Promise<void>,
  onFinished: (server: Project, sceneIds: readonly string[]) => void,
) {
  const [job, setJob] = useState<RenderJob | null>(null);
  const [pending, setPending] = useState<PendingVoiceRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Scenes whose own button led to `error`, so their card shows it; null when it concerns the panel. */
  const [errorScenes, setErrorScenes] = useState<readonly string[] | null>(null);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  // A voice job may still be running from before a reload: pick it up again.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    listJobs(projectId)
      .then((jobs) => {
        const running = jobs.filter(isVoiceJob).find((candidate) => isRunning(candidate));
        if (!cancelled && running) setJob(running);
      })
      .catch(() => {
        // Not fatal: the panel works without knowing older jobs.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);

  const running = isRunning(job);
  useEffect(() => {
    if (!job || !running) return;
    let cancelled = false;
    // A function, not the flag itself, so the checks after each await are not narrowed away.
    const stopped = () => cancelled;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next = await getJob(projectId, job.id);
          if (stopped()) return;
          if (isRunning(next)) {
            setJob(next);
            return;
          }
          // Some voices may be saved even when the job failed part way.
          const server = await fetchProject(projectId);
          if (stopped()) return;
          onFinishedRef.current(server, next.sceneIds ?? []);
          setJob(next);
          if (next.status === "FAILED") {
            const fallback =
              next.voice?.normalizeOnly === true ? "Cân bằng âm lượng thất bại." : "Tạo giọng thất bại.";
            setErrorScenes(next.voice?.normalizeOnly === true ? null : (next.sceneIds ?? null));
            setError(next.errorMessage ?? fallback);
          }
        } catch (cause) {
          if (!stopped()) setError(message(cause));
        }
      })();
    }, VOICE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, job, running]);

  /**
   * Saves pending edits, then asks the server what the run would cost and opens the confirmation.
   * `before` runs first, e.g. to give the project its default voice; its failure is shown like the others.
   */
  const prepare = useCallback(
    async (
      sceneIds?: readonly string[],
      options: { regenerate?: boolean; before?: () => Promise<void> } = {},
    ) => {
      const regenerate = options.regenerate === true;
      setBusy(true);
      setError(null);
      setErrorScenes(sceneIds ?? null);
      try {
        await options.before?.();
        // The estimate and the job read the stored project, so the latest edits must be saved first.
        await flushSave();
        const estimate = await estimateVoices(projectId, sceneIds, regenerate);
        if (estimate.sceneIds.length === 0) {
          setError("Không có cảnh nào cần tạo giọng.");
          return;
        }
        setPending({ ...(sceneIds && { sceneIds }), regenerate, estimate });
      } catch (cause) {
        setError(message(cause));
      } finally {
        setBusy(false);
      }
    },
    [projectId, flushSave],
  );

  const confirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    setErrorScenes(pending.sceneIds ?? null);
    try {
      await flushSave();
      setJob(await requestVoices(projectId, pending.estimate.sceneIds, pending.regenerate));
      setPending(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }, [projectId, pending, flushSave]);

  const cancel = useCallback(() => {
    setPending(null);
  }, []);

  /** Free, so no confirmation: saves pending edits, then queues the loudness job and polls it like the others. */
  const balanceLoudness = useCallback(async () => {
    setBusy(true);
    setError(null);
    setErrorScenes(null);
    try {
      await flushSave();
      setJob(await requestVoiceLoudness(projectId));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }, [projectId, flushSave]);

  return { job, running, pending, busy, error, errorScenes, prepare, confirm, cancel, balanceLoudness };
}

export type VoiceJobsState = ReturnType<typeof useVoiceJobs>;
