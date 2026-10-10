import { formatUsd, type AiTask, type AiTaskType, type Project, type VisualPlan } from "@studio/domain";

import type { AiEstimate } from "./api";

// Pure rules of the AI assistant: what each task is called, what a run costs, what to send.

export const AI_POLL_INTERVAL_MS = 1500;

export type VisualTask = Extract<AiTask, { type: "visual" }>;

export const AI_DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

export const AI_TASK_LABELS: Record<AiTaskType, string> = {
  script: "Viết script",
  scenes: "Chia cảnh",
  visual: "Gợi ý hình ảnh",
  rank_media: "Xếp hạng media",
  rewrite_scene: "Viết lại cảnh",
};

export { formatUsd };

/** `≈ 0,012 USD (tối đa 0,042 USD) · claude-sonnet-5-5` */
export function costLine(estimate: AiEstimate): string {
  return `≈ ${formatUsd(estimate.expectedUsd)} (tối đa ${formatUsd(estimate.maxUsd)}) · ${estimate.model}`;
}

/**
 * Whether a scene's plan has keywords in English, Vietnamese and Chinese. Plans written before the
 * multilingual keywords (English only) do not, so "missing" suggestions redo them.
 */
export function hasAllKeywords(plan: VisualPlan | undefined): boolean {
  return (
    plan !== undefined &&
    plan.searchQueries.length > 0 &&
    (plan.localizedQueries?.vi.length ?? 0) > 0 &&
    (plan.localizedQueries?.zh.length ?? 0) > 0
  );
}

/**
 * Visual-plan task for the scenes that have narration; `onlyMissing` keeps scenes whose plan is missing
 * or lacks keywords in one of the three languages. Null when no scene qualifies.
 */
export function visualTask(project: Project, onlyMissing: boolean): VisualTask | null {
  const scenes = project.scenes
    .filter((scene) => scene.narration.trim() !== "")
    .filter((scene) => !onlyMissing || !hasAllKeywords(scene.visualPlan))
    .map((scene) => ({ id: scene.id, narration: scene.narration }));
  if (scenes.length === 0) return null;
  return { type: "visual", input: { script: project.script, scenes } };
}

/** Scene numbers (1-based) of a list of scene ids: `1, 3`. */
export function sceneNumbers(project: Project, sceneIds: readonly string[]): string {
  const wanted = new Set(sceneIds);
  return project.scenes
    .flatMap((scene, index) => (wanted.has(scene.id) ? [String(index + 1)] : []))
    .join(", ");
}

/** Comma-separated search queries typed by the user → clean list. */
export function parseQueries(text: string): string[] {
  return text
    .split(",")
    .map((query) => query.replace(/\s+/gu, " ").trim())
    .filter((query) => query !== "");
}
