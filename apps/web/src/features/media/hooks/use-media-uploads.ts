"use client";

import type { MediaAsset } from "@studio/domain";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { uploadAsset, type UploadHandle } from "../api";
import { libraryNote, nextUpload, rejectReason, uploadsReducer } from "../uploads";

/**
 * Sends dropped files one by one and reports each finished asset to `onUploaded`. `addToLibrary` is read
 * when each file starts, so switching it applies to the files still waiting.
 */
export function useMediaUploads(
  projectId: string,
  onUploaded: (asset: MediaAsset) => void,
  options: { addToLibrary?: boolean } = {},
) {
  const [items, dispatch] = useReducer(uploadsReducer, []);
  const files = useRef(new Map<string, File>());
  const active = useRef<UploadHandle | null>(null);
  const counter = useRef(0);
  const onUploadedRef = useRef(onUploaded);
  const addToLibraryRef = useRef(options.addToLibrary);

  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  useEffect(() => {
    addToLibraryRef.current = options.addToLibrary;
  }, [options.addToLibrary]);

  useEffect(() => {
    const next = nextUpload(items);
    const file = next ? files.current.get(next.id) : undefined;
    if (!next || !file) return;
    dispatch({ type: "start", id: next.id });
    const handle = uploadAsset(
      projectId,
      file,
      (fraction) => {
        dispatch({ type: "progress", id: next.id, fraction });
      },
      addToLibraryRef.current === undefined ? {} : { addToLibrary: addToLibraryRef.current },
    );
    active.current = handle;
    handle.promise
      .then(({ asset, library }) => {
        dispatch({ type: "done", id: next.id, note: libraryNote(library) });
        onUploadedRef.current(asset);
      })
      .catch((error: unknown) => {
        dispatch({
          type: "fail",
          id: next.id,
          error: error instanceof Error ? error.message : "Tải lên thất bại.",
        });
      })
      .finally(() => {
        files.current.delete(next.id);
        if (active.current === handle) active.current = null;
      });
  }, [items, projectId]);

  // Leaving the page cancels the upload in flight instead of letting it finish unseen.
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );

  const addFiles = useCallback((list: FileList | readonly File[]) => {
    const added = Array.from(list).map((file) => {
      const id = `upload-${String(++counter.current)}`;
      if (rejectReason(file.name) === null) files.current.set(id, file);
      return { id, fileName: file.name, size: file.size };
    });
    if (added.length > 0) dispatch({ type: "add", files: added });
  }, []);

  const clearFinished = useCallback(() => {
    dispatch({ type: "clearFinished" });
  }, []);

  return { items, addFiles, clearFinished, busy: items.some((item) => item.status === "uploading") };
}
