import {
  FULL_AI_STEP_LABELS,
  formatUsd,
  sceneVoiceStatus,
  type FullAiRequest,
  type FullAiResult,
  type FullAiStep,
  type MediaCandidate,
  type MediaRankingMode,
  type Project,
  type RenderJob,
} from "@studio/domain";

import type { FullAiEstimate } from "./api";

// Pure rules of the Full AI panel and the review screen.

export const FULL_AI_POLL_INTERVAL_MS = 2000;

export const FULL_AI_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

export const RANKING_MODE_LABELS: Record<MediaRankingMode, { title: string; description: string }> = {
  text: { title: "Theo mô tả", description: "AI đọc mô tả và tag của từng media. Rẻ." },
  vision: {
    title: "Xem ảnh",
    description: "AI nhìn thumbnail của từng media. Chính xác hơn, tốn gấp nhiều lần.",
  },
};

export interface FullAiForm {
  idea: string;
  targetDurationSec: number;
  tone: string;
  rankingMode: MediaRankingMode;
}

export function initialForm(project: Project): FullAiForm {
  return { idea: "", targetDurationSec: 30, tone: "", rankingMode: project.mediaRankingMode ?? "text" };
}

/** Why the run cannot start yet, or null. Mirrors assertFullAiRequest so the button explains itself. */
export function formError(form: FullAiForm, steps: readonly FullAiStep[], project: Project): string | null {
  if (steps.includes("script")) {
    return form.idea.trim().length < 3 ? "Nhập ý tưởng (ít nhất 3 ký tự)." : null;
  }
  return project.script.trim() === ""
    ? "Viết script trước, hoặc bật “Viết script” trong cài đặt dự án để AI viết từ ý tưởng."
    : null;
}

export function toRequest(form: FullAiForm, replaceScenes: boolean): FullAiRequest {
  const idea = form.idea.trim();
  const tone = form.tone.trim();
  return {
    ...(idea !== "" && { idea }),
    targetDurationSec: form.targetDurationSec,
    ...(tone !== "" && { tone }),
    rankingMode: form.rankingMode,
    replaceScenes,
  };
}

/** `Viết script → Chia cảnh → Tạo giọng` */
export function stepsLine(steps: readonly FullAiStep[]): string {
  return steps.map((step) => FULL_AI_STEP_LABELS[step]).join(" → ");
}

/** `Chia cảnh: ≈ 0,010 USD (tối đa 0,064 USD)` for each paid step. */
export function costLines(estimate: FullAiEstimate): string[] {
  return estimate.costs.map(
    (cost) =>
      `${FULL_AI_STEP_LABELS[cost.step]}: ≈ ${formatUsd(cost.expectedUsd)} (tối đa ${formatUsd(cost.maxUsd)})`,
  );
}

export function isRunning(job: RenderJob | null): boolean {
  return job !== null && (job.status === "QUEUED" || job.status === "PROCESSING");
}

/** `Bước 2/6: Chia cảnh · 40%` */
export function progressLine(job: RenderJob): string {
  if (job.status === "QUEUED") return "Đang chờ worker…";
  const steps = job.fullAi?.steps ?? [];
  const step = job.fullAi?.step;
  const percent = `${String(Math.round(job.progress * 100))}%`;
  if (step === undefined) return `Đang bắt đầu… · ${percent}`;
  return `Bước ${String(steps.indexOf(step) + 1)}/${String(steps.length)}: ${FULL_AI_STEP_LABELS[step]} · ${percent}`;
}

export interface ReviewStats {
  total: number;
  approved: number;
  withMedia: number;
  /** Scenes whose voice is missing or no longer matches the narration. */
  voiceToRedo: number;
}

export function reviewStats(project: Project): ReviewStats {
  let approved = 0;
  let withMedia = 0;
  let voiceToRedo = 0;
  for (const scene of project.scenes) {
    if (scene.status === "approved") approved += 1;
    if (scene.media) withMedia += 1;
    const voice = sceneVoiceStatus(project, scene);
    if (project.voice !== undefined && (voice === "missing" || voice === "outdated")) voiceToRedo += 1;
  }
  return { total: project.scenes.length, approved, withMedia, voiceToRedo };
}

/** The ranked candidates of a scene, without the one it already uses. */
export function alternativesFor(
  result: FullAiResult | null,
  project: Project,
  sceneId: string,
): MediaCandidate[] {
  const candidates = result?.scenes.find((scene) => scene.sceneId === sceneId)?.candidates ?? [];
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  const current = project.assets.find((asset) => asset.id === scene?.media?.assetId);
  // Imported stock files are named `<provider>-<ref>.<ext>`; library copies keep that name too.
  return candidates.filter(
    (candidate) =>
      current === undefined || !current.fileName.startsWith(`${candidate.provider}-${candidate.ref}.`),
  );
}
