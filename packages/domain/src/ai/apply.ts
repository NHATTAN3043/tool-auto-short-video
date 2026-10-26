import { DomainError } from "../errors";
import { newId, type DomainContext } from "../ids";
import { projectLanguage } from "../project/operations";
import type { AutomationSettings, Project } from "../project/schema";
import type { Scene } from "../scene/schema";
import { normalizeScenePlan, normalizeVisualPlan } from "./normalize";
import type { AiTask, AiTaskType, ScenePlanSuggestion, VisualPlansSuggestion } from "./schema";

/** The automation toggle that allows each AI task; code checks the toggle, never the mode. */
export const AI_TASK_TOGGLES: Readonly<Record<AiTaskType, keyof AutomationSettings>> = {
  script: "scriptGeneration",
  scenes: "scenePlanning",
  visual: "visualKeywords",
  rank_media: "mediaRanking",
  // Rewriting a scene is writing narration, like writing the script.
  rewrite_scene: "scriptGeneration",
  // The questions and the outline are the first half of writing the script (ADR 0015).
  brief_questions: "scriptGeneration",
  script_outline: "scriptGeneration",
  // Cutting a source video into scenes and writing their narration (ADR 0020).
  source_cut: "scenePlanning",
};

export function assertAiTaskAllowed(project: Project, task: AiTask): void {
  if (task.type === "visual" && task.input.onDemand === true) {
    if (task.input.scenes.length !== 1) {
      throw new DomainError("INVALID_INPUT", "An on-demand keyword suggestion is for one scene");
    }
    return;
  }
  const toggle = AI_TASK_TOGGLES[task.type];
  if (!project.automationSettings[toggle]) {
    throw new DomainError("INVALID_OPERATION", `Automation "${toggle}" is turned off for this project`);
  }
}

/**
 * The task with the project language set on the tasks that write or split narration (ADR 0013). The
 * server fills it, so the browser cannot ask for a language the project does not speak.
 */
export function withProjectLanguage(task: AiTask, project: Project): AiTask {
  const language = projectLanguage(project);
  switch (task.type) {
    case "script":
      return { ...task, input: { ...task.input, language } };
    case "scenes":
      return { ...task, input: { ...task.input, language } };
    case "rewrite_scene":
      return { ...task, input: { ...task.input, language } };
    case "brief_questions":
      return { ...task, input: { ...task.input, language } };
    case "script_outline":
      return { ...task, input: { ...task.input, language } };
    case "source_cut":
      return { ...task, input: { ...task.input, language } };
    case "visual":
    case "rank_media":
      return task;
  }
}

/**
 * Replaces every scene with the AI scene plan (narration + visual plan). Like splitting the script again,
 * the old scenes and what was attached to them are dropped from the scene list; assets stay in the project.
 */
export function applyScenePlan(
  project: Project,
  plan: ScenePlanSuggestion,
  ctx: DomainContext = {},
): Project {
  const { scenes: suggested } = normalizeScenePlan(plan);
  const scenes = suggested.map((scene): Scene => ({
    id: (ctx.newId ?? newId)("scn"),
    narration: scene.narration,
    visualPlan: scene.visualPlan,
    status: "draft",
  }));
  return { ...project, scenes };
}

/** Sets the visual plan of the scenes it names; media, voice and narration are left untouched. */
export function applyVisualPlans(project: Project, suggestion: VisualPlansSuggestion): Project {
  const plans = new Map(suggestion.plans.map((plan) => [plan.sceneId, normalizeVisualPlan(plan.visualPlan)]));
  if (!project.scenes.some((scene) => plans.has(scene.id))) return project;
  const scenes = project.scenes.map((scene) => {
    const visualPlan = plans.get(scene.id);
    return visualPlan ? { ...scene, visualPlan } : scene;
  });
  return { ...project, scenes };
}
