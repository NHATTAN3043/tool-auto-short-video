import { formatUsd, type LibraryMedia, type RenderJob } from "@studio/domain";

import type { ClipAnalysisEstimate } from "./api";

// Pure rules of clip analysis in the shared library panel (ADR 0019).

export const CLIP_POLL_INTERVAL_MS = 2000;

/** Only videos are cut into shots. */
export function canAnalyze(item: Pick<LibraryMedia, "kind">): boolean {
  return item.kind === "video";
}

/** `Chưa phân tích`, or `12 đoạn · 3 có chữ` once analyzed. */
export function analysisLabel(item: Pick<LibraryMedia, "kind" | "analysis">): string | null {
  if (!canAnalyze(item)) return null;
  if (!item.analysis) return "Chưa phân tích";
  const withText = item.analysis.shots.filter((shot) => shot.textOverlay).length;
  const shots = `${String(item.analysis.shots.length)} đoạn`;
  return withText > 0 ? `${shots} · ${String(withText)} có chữ/logo` : shots;
}

export const SKIP_LABELS: Record<ClipAnalysisEstimate["skipped"][number]["reason"], string> = {
  not_found: "không còn trong kho",
  not_video: "không phải video",
  analyzed: "đã phân tích",
  no_duration: "không rõ độ dài",
};

/** `2 video, khoảng 60 đoạn` */
export function clipsLine(estimate: ClipAnalysisEstimate): string {
  const shots = estimate.clips.reduce((sum, clip) => sum + clip.expectedShots, 0);
  return `${String(estimate.clips.length)} video, khoảng ${String(shots)} đoạn`;
}

/** `≈ 0,040 USD (tối đa 0,210 USD) · claude-sonnet-5-5` */
export function clipCostLine(estimate: ClipAnalysisEstimate): string {
  return `≈ ${formatUsd(estimate.expectedUsd)} (tối đa ${formatUsd(estimate.maxUsd)}) · ${estimate.model}`;
}

/** Videos left out of the estimate and why, by file name when the panel knows it. */
export function skippedLines(estimate: ClipAnalysisEstimate, items: readonly LibraryMedia[]): string[] {
  const names = new Map(items.map((item) => [item.id, item.fileName]));
  return estimate.skipped.map((skip) => `${names.get(skip.id) ?? skip.id}: ${SKIP_LABELS[skip.reason]}`);
}

/** `0:12,5` */
export function shotTime(ms: number): string {
  const tenths = Math.round(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${String(minutes)}:${String(seconds).padStart(2, "0")},${String(tenths % 10)}`;
}

export type ClipJobView =
  { state: "running"; text: string } | { state: "done"; text: string } | { state: "failed"; text: string };

/** What the panel says about the analysis job it started. */
export function clipJobView(job: RenderJob): ClipJobView {
  const total = job.clip?.libraryIds.length ?? 0;
  const cost = job.clip?.costUsd === undefined ? "" : ` · ${formatUsd(job.clip.costUsd)}`;
  if (job.status === "QUEUED") return { state: "running", text: `Đang chờ worker (${String(total)} video)…` };
  if (job.status === "PROCESSING") {
    return {
      state: "running",
      text: `Đang phân tích ${String(total)} video… ${String(Math.round(job.progress * 100))}%`,
    };
  }
  if (job.status === "COMPLETED")
    return { state: "done", text: `Đã phân tích ${String(total)} video${cost}` };
  return { state: "failed", text: `${job.errorMessage ?? "Phân tích thất bại"}${cost}` };
}
