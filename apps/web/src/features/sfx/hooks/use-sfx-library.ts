"use client";

import type { LibrarySfx } from "@studio/domain";
import { useCallback, useEffect, useState } from "react";

import { deleteSfx, listSfx, renameSfx, uploadSfx } from "../api";

const message = (error: unknown) => (error instanceof Error ? error.message : "Đã có lỗi xảy ra.");

/** The shared sound effect library as seen by one page. */
export function useSfxLibrary() {
  const [items, setItems] = useState<LibrarySfx[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listSfx()
      .then((list) => {
        if (active) setItems(list);
      })
      .catch((err: unknown) => {
        if (active) setError(message(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  /** Uploads one by one so a bad file does not stop the others; reports the failures together. */
  const upload = useCallback(async (files: readonly File[]) => {
    setUploading(true);
    setError(null);
    const failures: string[] = [];
    for (const file of files) {
      try {
        const item = await uploadSfx(file);
        setItems((current) => [item, ...current]);
      } catch (err) {
        failures.push(`${file.name}: ${message(err)}`);
      }
    }
    setUploading(false);
    if (failures.length > 0) setError(failures.join(" "));
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    try {
      const item = await renameSfx(id, name);
      setItems((current) => current.map((existing) => (existing.id === id ? item : existing)));
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await deleteSfx(id);
      setItems((current) => current.filter((item) => item.id !== id));
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, []);

  return { items, loading, uploading, error, upload, rename, remove, setError };
}

export type SfxLibraryState = ReturnType<typeof useSfxLibrary>;
