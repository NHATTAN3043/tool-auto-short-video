"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchVoiceCatalog, type VoiceCatalog } from "../api";

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Không tải được danh sách giọng.";

/** Voices and models of the TTS provider; loaded only while voice generation is shown. */
export function useVoiceCatalog(enabled: boolean) {
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchVoiceCatalog()
      .then((loaded) => {
        if (cancelled) return;
        setCatalog(loaded);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(message(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { catalog, error, loading: enabled && catalog === null && error === null, retry };
}

export type VoiceCatalogState = ReturnType<typeof useVoiceCatalog>;
