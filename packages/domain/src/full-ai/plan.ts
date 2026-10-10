import { DomainError } from "../errors";
import type { MediaRankingMode } from "../media/search";
import type { AutomationSettings, Project } from "../project/schema";
import type { FullAiRequest, FullAiStep } from "./schema";

/** Vietnamese, shown in the progress line and in the error of a stopped run. */
export const FULL_AI_STEP_LABELS: Readonly<Record<FullAiStep, string>> = {
  script: "Viết script",
  scenes: "Chia cảnh",
  visual: "Gợi ý hình ảnh",
  media: "Tìm media",
  rank: "Xếp hạng media",
  select: "Chọn media",
  voice: "Tạo giọng",
};

/**
 * The steps a Full AI run takes, in order. Each follows its toggle (never the mode name):
 * scenes always exist; the AI plans them with `scenePlanning`, otherwise the script is split and
 * `visualKeywords` adds search queries. The shared library is searched even without `mediaSearch`.
 */
export function fullAiSteps(settings: AutomationSettings, available: { tts: boolean }): FullAiStep[] {
  const steps: FullAiStep[] = [];
  if (settings.scriptGeneration) steps.push("script");
  steps.push("scenes");
  if (!settings.scenePlanning && settings.visualKeywords) steps.push("visual");
  if (settings.mediaSearch || settings.mediaRanking || settings.autoMediaSelection) steps.push("media");
  if (settings.mediaRanking) steps.push("rank");
  if (settings.autoMediaSelection) steps.push("select");
  if (settings.voiceGeneration && available.tts) steps.push("voice");
  return steps;
}

/** Steps that make a paid call. */
export function isPaidFullAiStep(step: FullAiStep, settings: AutomationSettings): boolean {
  if (step === "scenes") return settings.scenePlanning;
  return step === "script" || step === "visual" || step === "rank" || step === "voice";
}

/** Refuses a run that cannot start: no idea and no script, or scenes the user did not agree to replace. */
export function assertFullAiRequest(
  project: Project,
  request: FullAiRequest,
  steps: readonly FullAiStep[],
): void {
  if (steps.includes("script")) {
    if ((request.idea ?? "").length < 3) {
      throw new DomainError("INVALID_INPUT", "Full AI needs an idea of at least 3 characters");
    }
  } else if (project.script.trim() === "") {
    throw new DomainError("INVALID_OPERATION", "Write a script first or turn on script generation");
  }
  if (project.scenes.length > 0 && !request.replaceScenes) {
    throw new DomainError("INVALID_OPERATION", "Full AI replaces the existing scenes; confirm first");
  }
}

/** Remembers the ranking mode chosen last, preselected next time. */
export function setMediaRankingMode(project: Project, mode: MediaRankingMode): Project {
  return { ...project, mediaRankingMode: mode };
}
