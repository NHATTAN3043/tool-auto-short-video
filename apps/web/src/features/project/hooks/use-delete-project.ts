"use client";

import { useState } from "react";

import { deleteProject } from "../api";

/** Confirm, then delete; the dialog stays open on failure so the reason (a running job…) is shown. */
export function useDeleteProject(projectId: string, onDeleted: () => void) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await deleteProject(projectId);
      setOpen(false);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được dự án.");
    } finally {
      setBusy(false);
    }
  }

  return {
    open,
    busy,
    error,
    setOpen: (next: boolean) => {
      if (busy) return;
      setOpen(next);
      if (!next) setError(null);
    },
    confirm,
  };
}
