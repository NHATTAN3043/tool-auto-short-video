import { DomainError } from "../errors";
import { newId, type DomainContext } from "../ids";
import type { MediaRankingMode } from "../media/search";
import type { AutomationSettings, Project } from "../project/schema";
import type { Scene } from "../scene/schema";
import type { SkillId } from "../skill/schema";
import { normalizeWhitespace } from "../text/words";
import type { FullAiOutline, FullAiRequest, FullAiStep } from "./schema";

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
 * With an approved outline (ADR 0015) no script is written: the outline becomes the scenes, and only
 * the scenes without a visual plan get one, when either AI toggle allows it.
 */
export function fullAiSteps(
  settings: AutomationSettings,
  available: { tts: boolean },
  outline?: FullAiOutline,
): FullAiStep[] {
  const steps: FullAiStep[] = [];
  if (outline) {
    steps.push("scenes");
    if (outlineScenesWithoutPlan(outline) > 0 && (settings.scenePlanning || settings.visualKeywords)) {
      steps.push("visual");
    }
  } else {
    if (settings.scriptGeneration) steps.push("script");
    steps.push("scenes");
    if (!settings.scenePlanning && settings.visualKeywords) steps.push("visual");
  }
  if (settings.mediaSearch || settings.mediaRanking || settings.autoMediaSelection) steps.push("media");
  if (settings.mediaRanking) steps.push("rank");
  if (settings.autoMediaSelection) steps.push("select");
  if (settings.voiceGeneration && available.tts) steps.push("voice");
  return steps;
}

/** Scenes of an outline that still need a visual plan from the AI. */
export function outlineScenesWithoutPlan(outline: FullAiOutline): number {
  return outline.scenes.filter((scene) => scene.visualPlan === undefined).length;
}

/**
 * The approved outline as the project's script and scenes, narration kept word for word. Like a scene
 * plan, the old scenes are dropped from the list; their assets stay in the project.
 */
export function applyFullAiOutline(
  project: Project,
  outline: FullAiOutline,
  ctx: DomainContext = {},
): Project {
  const scenes = outline.scenes
    .map((scene) => ({ ...scene, narration: normalizeWhitespace(scene.narration) }))
    .filter((scene) => scene.narration !== "")
    .map((scene): Scene => ({
      id: (ctx.newId ?? newId)("scn"),
      narration: scene.narration,
      ...(scene.visualPlan && { visualPlan: scene.visualPlan }),
      status: "draft",
    }));
  if (scenes.length === 0) throw new DomainError("INVALID_INPUT", "The outline has no narration");
  return { ...project, script: scenes.map((scene) => scene.narration).join("\n\n"), scenes };
}

/** Steps that make a paid call. */
export function isPaidFullAiStep(
  step: FullAiStep,
  settings: AutomationSettings,
  withOutline = false,
): boolean {
  if (step === "scenes") return !withOutline && settings.scenePlanning;
  return step === "script" || step === "visual" || step === "rank" || step === "voice";
}

/** Refuses a run that cannot start: no idea and no script, or scenes the user did not agree to replace. */
export function assertFullAiRequest(
  project: Project,
  request: FullAiRequest,
  steps: readonly FullAiStep[],
): void {
  if (request.outline) {
    // The outline is the script; the schema guarantees at least one scene.
  } else if (steps.includes("script")) {
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

/** Remembers the skill chosen last (Full AI and rewrites), preselected next time; undefined = none. */
export function setAiSkill(project: Project, skillId: SkillId | undefined): Project {
  const next = { ...project };
  delete next.aiSkillId;
  return skillId === undefined ? next : { ...next, aiSkillId: skillId };
}
