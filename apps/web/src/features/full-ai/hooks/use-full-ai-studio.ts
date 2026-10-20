"use client";

import { budgetExceededMessage, type AiResult, type AiTask, type FullAiDraft } from "@studio/domain";
import { useCallback, useEffect, useRef, useState } from "react";

import { AI_POLL_INTERVAL_MS, estimateAi, getAiJob, getAiResult, requestAi } from "@/features/ai";

import { saveFullAiDraft } from "../api";

const message = (error: unknown) => (error instanceof Error ? error.message : "Đã có lỗi xảy ra.");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Saves this long after the last change, so typing does not send a request per key. */
const DRAFT_SAVE_DELAY_MS = 600;
/** Estimates are free but count tokens remotely: only once the input settles. */
const ESTIMATE_DELAY_MS = 900;

export type DraftSaveStatus = "saved" | "saving" | "error";

/**
 * The Full AI draft on the page (ADR 0015): every change is applied at once and saved shortly after.
 * `flush` saves now, before the page leaves or a run starts.
 */
export function useFullAiDraft(projectId: string, initial: FullAiDraft) {
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<DraftSaveStatus>("saved");
  const latest = useRef(initial);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return;
    dirty.current = false;
    setStatus("saving");
    const sent = latest.current;
    try {
      await saveFullAiDraft(projectId, sent);
      // A change made while saving is saved by its own timer.
      setStatus(latest.current === sent ? "saved" : "saving");
    } catch {
      dirty.current = true;
      setStatus("error");
    }
  }, [projectId]);

  const change = useCallback(
    (update: (current: FullAiDraft) => FullAiDraft) => {
      const next = update(latest.current);
      if (next === latest.current) return;
      latest.current = next;
      setDraft(next);
      dirty.current = true;
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, DRAFT_SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { draft, change, flush, status };
}

export type AiRunOutcome = { ok: true; result: AiResult } | { ok: false; error: string };

/**
 * Runs one AI task to its result: estimate (refused over budget), queue a worker job, poll it, read the
 * result. A failure resolves with its reason, also kept in `error` for display. One task at a time.
 */
export function useAiRun(projectId: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (task: AiTask): Promise<AiRunOutcome> => {
      setBusy(true);
      setError(null);
      try {
        const estimate = await estimateAi(projectId, task);
        const blocked = budgetExceededMessage(estimate.budget);
        if (blocked !== null) throw new Error(blocked);
        let job = await requestAi(projectId, task);
        while (job.status === "QUEUED" || job.status === "PROCESSING") {
          await wait(AI_POLL_INTERVAL_MS);
          if (!mounted.current) return { ok: false, error: "Đã rời trang." };
          job = await getAiJob(projectId, job.id);
        }
        if (job.status !== "COMPLETED") throw new Error(job.errorMessage ?? "AI không chạy được.");
        return { ok: true, result: await getAiResult(projectId, job.id) };
      } catch (cause) {
        const reason = message(cause);
        if (mounted.current) setError(reason);
        return { ok: false, error: reason };
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [projectId],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { run, busy, error, clearError };
}

/**
 * A free estimate shown before the button is pressed, refreshed once `key` stops changing. Null while
 * there is nothing to estimate (`key` null) or when it failed: the hint is only a convenience.
 */
export function useEstimate<T>(key: string | null, load: () => Promise<T>): T | null {
  const [result, setResult] = useState<{ key: string; value: T } | null>(null);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      loadRef
        .current()
        .then((value) => {
          if (!cancelled) setResult({ key, value });
        })
        .catch(() => {
          // A hint only: the run is estimated and checked again when it starts.
        });
    }, ESTIMATE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  return key !== null && result?.key === key ? result.value : null;
}
