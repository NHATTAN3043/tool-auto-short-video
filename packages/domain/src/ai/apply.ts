import { DomainError } from "../errors";
import { newId, type DomainContext } from "../ids";
import type { AutomationSettings, Project } from "../project/schema";
import type { Scene } from "../scene/schema";
import { normalizeScenePlan, normalizeVisualPlan } from "./normalize";
import type { AiTaskType, ScenePlanSuggestion, VisualPlansSuggestion } from "./schema";

/** The automation toggle that allows each AI task; code checks the toggle, never the mode. */
export const AI_TASK_TOGGLES: Readonly<Record<AiTaskType, keyof AutomationSettings>> = {
  script: "scriptGeneration",
  scenes: "scenePlanning",
  visual: "visualKeywords",
  rank_media: "mediaRanking",
  // Rewriting a scene is writing narration, like writing the script.
  rewrite_scene: "scriptGeneration",
};

export function assertAiTaskAllowed(project: Project, type: AiTaskType): void {
  const toggle = AI_TASK_TOGGLES[type];
  if (!project.automationSettings[toggle]) {
    throw new DomainError("INVALID_OPERATION", `Automation "${toggle}" is turned off for this project`);
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
