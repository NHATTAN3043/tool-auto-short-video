"use client";

import type { RenderJob } from "@studio/domain";
import { useCallback, useEffect, useState } from "react";

import { getRender, listRenders, requestRender } from "../api";
import { isActive, isOutputJob, POLL_INTERVAL_MS, upsertJob, type OutputKind } from "../jobs";

const message = (error: unknown) => (error instanceof Error ? error.message : "Đã có lỗi xảy ra.");

/**
 * Render jobs of the project: loads the history, starts a render after the latest edits are saved, and
 * polls the running job until the worker finishes it.
 */
export function useRenderJobs(projectId: string, flushSave: () => Promise<void>) {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listRenders(projectId)
      .then((loaded) => {
        if (!cancelled) setJobs(loaded.filter(isOutputJob));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(message(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const active = jobs.find(isActive);
  const activeId = active?.id;

  useEffect(() => {
    if (activeId === undefined) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getRender(projectId, activeId)
        .then((job) => {
          if (!cancelled) setJobs((current) => upsertJob(current, job));
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(message(cause));
        });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `jobs` changes after every poll, which schedules the next one.
  }, [projectId, activeId, jobs]);

  const start = useCallback(
    async (kind: OutputKind = "video") => {
      setStarting(true);
      setError(null);
      try {
        // The worker renders what is on disk, so the latest edits must be saved first.
        await flushSave();
        const job = await requestRender(projectId, kind);
        setJobs((current) => upsertJob(current, job));
      } catch (cause) {
        setError(message(cause));
      } finally {
        setStarting(false);
      }
    },
    [projectId, flushSave],
  );

  return { jobs, active, error, starting, start };
}
