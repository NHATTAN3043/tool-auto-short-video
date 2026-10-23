import type { ProjectWarning, RenderJob, RenderJobKind, RenderJobStatus, Scene } from "@studio/domain";

// Pure rules of the render panel: what is still running, what to call the downloads, what to warn about.

export const POLL_INTERVAL_MS = 1500;

/** How many past renders the panel shows. */
export const HISTORY_LIMIT = 5;

export const STATUS_LABELS: Record<RenderJobStatus, string> = {
  QUEUED: "Đang chờ worker",
  PROCESSING: "Đang render",
  COMPLETED: "Xong",
  FAILED: "Lỗi",
  CANCELLED: "Đã huỷ",
};

/** Kinds the render panel starts and lists; voice and AI jobs belong to their own features. */
export type OutputKind = Extract<RenderJobKind, "video" | "capcut">;

export const KIND_LABELS: Record<RenderJobKind, string> = {
  video: "Video MP4",
  capcut: "Gói CapCut",
  tts: "Tạo giọng",
  ai: "Gợi ý AI",
  full_ai: "Full AI",
  clip: "Phân tích clip",
};

/** Render panel jobs only: video and CapCut, not voice generation or AI suggestions. */
export function isOutputJob(job: RenderJob): boolean {
  const kind = kindOf(job);
  return kind === "video" || kind === "capcut";
}

export function kindOf(job: RenderJob): RenderJobKind {
  return job.kind ?? "video";
}

export function isActive(job: RenderJob): boolean {
  return job.status === "QUEUED" || job.status === "PROCESSING";
}

/** Replaces the job with the same id, or adds it on top (newest first). */
export function upsertJob(jobs: readonly RenderJob[], job: RenderJob): RenderJob[] {
  return jobs.some((existing) => existing.id === job.id)
    ? jobs.map((existing) => (existing.id === job.id ? job : existing))
    : [job, ...jobs];
}

/** ASCII file name from a Vietnamese project name: `Video đầu tiên` → `video-dau-tien`. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/[đĐ]/gu, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug === "" ? "video" : slug;
}

/**
 * `video-dau-tien-2026-10-04-1430.mp4`, from the time the render was requested; the CapCut package is
 * `…-capcut.zip`.
 */
export function downloadName(projectName: string, job: RenderJob, extension: "mp4" | "srt" | "zip"): string {
  const stamp = job.createdAt.slice(0, 16).replace("T", "-").replace(":", "");
  const suffix = extension === "zip" ? "-capcut" : "";
  return `${slugify(projectName)}-${stamp}${suffix}.${extension}`;
}

function sceneNumbers(scenes: readonly Scene[], sceneIds: readonly string[]): string {
  const wanted = new Set(sceneIds);
  return scenes.flatMap((scene, index) => (wanted.has(scene.id) ? [String(index + 1)] : [])).join(", ");
}

/** Vietnamese text for each warning from reviewProject. */
export function warningMessages(warnings: readonly ProjectWarning[], scenes: readonly Scene[]): string[] {
  return warnings.map((warning) => {
    switch (warning.code) {
      case "NO_SCENES":
        return "Dự án chưa có cảnh nào.";
      case "SCENE_WITHOUT_MEDIA":
        return `Cảnh ${sceneNumbers(scenes, warning.sceneIds)} chưa có media (sẽ hiện nền tối).`;
      case "VIDEO_TOO_LONG":
        return `Video dài ${String(Math.round(warning.durationMs / 1000))} giây, quá ${String(warning.limitMs / 60_000)} phút.`;
    }
  });
}
