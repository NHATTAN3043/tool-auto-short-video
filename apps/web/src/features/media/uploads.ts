import { ACCEPTED_EXTENSIONS, mediaKindFromFileName } from "@studio/domain";

// Upload queue of the media panel: files go up one at a time, each with its own progress and error.

export type UploadStatus = "queued" | "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  fileName: string;
  size: number;
  status: UploadStatus;
  /** 0..1 */
  progress: number;
  error?: string;
}

export type UploadAction =
  | { type: "add"; files: { id: string; fileName: string; size: number }[] }
  | { type: "start"; id: string }
  | { type: "progress"; id: string; fraction: number }
  | { type: "done"; id: string }
  | { type: "fail"; id: string; error: string }
  | { type: "clearFinished" };

const EXTENSIONS = Object.values(ACCEPTED_EXTENSIONS).flat();

/** Value of the file input `accept` attribute. */
export const ACCEPT_ATTRIBUTE = EXTENSIONS.map((extension) => `.${extension}`).join(",");

/** Checked in the browser too, so an obviously wrong file never starts uploading. */
export function rejectReason(fileName: string): string | null {
  return mediaKindFromFileName(fileName) === null
    ? `Định dạng không hỗ trợ. Chỉ nhận ${EXTENSIONS.join(", ")}.`
    : null;
}

function patch(items: UploadItem[], id: string, change: Partial<UploadItem>): UploadItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...change } : item));
}

export function uploadsReducer(items: UploadItem[], action: UploadAction): UploadItem[] {
  switch (action.type) {
    case "add":
      return [
        ...items,
        ...action.files.map((file): UploadItem => {
          const error = rejectReason(file.fileName);
          return error === null
            ? { ...file, status: "queued", progress: 0 }
            : { ...file, status: "error", progress: 0, error };
        }),
      ];
    case "start":
      return patch(items, action.id, { status: "uploading", progress: 0 });
    case "progress":
      return patch(items, action.id, { progress: Math.min(1, Math.max(0, action.fraction)) });
    case "done":
      return patch(items, action.id, { status: "done", progress: 1 });
    case "fail":
      return patch(items, action.id, { status: "error", error: action.error });
    case "clearFinished":
      return items.filter((item) => item.status === "queued" || item.status === "uploading");
  }
}

/** The next file to send, or null while one is already uploading or nothing is waiting. */
export function nextUpload(items: readonly UploadItem[]): UploadItem | null {
  if (items.some((item) => item.status === "uploading")) return null;
  return items.find((item) => item.status === "queued") ?? null;
}
