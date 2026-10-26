import { z } from "zod";

import {
  AI_BRIEF_MAX_OPTIONS,
  AI_BRIEF_MAX_QUESTIONS,
  AI_IDEA_MAX_CHARACTERS,
  AI_SCRIPT_MAX_SECONDS,
  AI_SCRIPT_MIN_SECONDS,
  BriefQuestionSchema,
  SourcePartSchema,
  SourceScriptRoleSchema,
  type BriefAnswer,
  type BriefQuestionsSuggestion,
  type ScriptOutlineSuggestion,
} from "../ai/schema";
import { newId, type DomainContext } from "../ids";
import { MediaRankingModeSchema, type MediaRankingMode } from "../media/search";
import { VisualPlanSchema } from "../scene/schema";
import { SkillIdSchema, type SkillId } from "../skill/schema";
import { countWords, normalizeWhitespace } from "../text/words";
import type { FullAiOutline } from "./schema";

// The Full AI draft (ADR 0015): idea → questions → outline, saved as `projects/<id>/full-ai/draft.json`
// apart from the project, so the editor's autosave never overwrites it. Cleared when a run finishes.

export const FULL_AI_DRAFT_SCHEMA_VERSION = 1;

/** Speaking rate used for script length everywhere (see the script prompt). */
export const FULL_AI_WORDS_PER_SECOND = 2.6;
/** About 9 seconds: longer scenes hold one shot too long, so the outline suggests splitting them. */
export const OUTLINE_LONG_SCENE_WORDS = 24;
/** The outline is flagged when it runs more than 15% over the target length. */
export const OUTLINE_OVER_TARGET_RATIO = 1.15;

export const FullAiDraftStepSchema = z.enum(["idea", "questions", "outline"]);
export type FullAiDraftStep = z.infer<typeof FullAiDraftStepSchema>;

export const DraftAnswerSchema = z.object({
  questionId: z.string().min(1).max(40),
  /** Indexes of the chosen options. */
  selected: z.array(z.number().int().min(0)).max(AI_BRIEF_MAX_OPTIONS),
  /** "Khác…" is chosen; its text is `other`. Free-text questions use `other` only. */
  otherOn: z.boolean(),
  other: z.string().max(500),
});
export type DraftAnswer = z.infer<typeof DraftAnswerSchema>;

export const OutlineSceneSchema = z.object({
  id: z.string().min(1),
  narration: z.string().max(5000),
  visualPlan: VisualPlanSchema.optional(),
  /** The narration the visual plan was made for; after an edit the AI suggests a new plan. */
  plannedNarration: z.string().max(5000).optional(),
});
export type OutlineScene = z.infer<typeof OutlineSceneSchema>;

export const DraftOutlineSchema = z.object({
  title: z.string().max(300),
  scenes: z.array(OutlineSceneSchema).max(100),
});
export type DraftOutline = z.infer<typeof DraftOutlineSchema>;

export const FullAiDraftSchema = z.object({
  schemaVersion: z.literal(FULL_AI_DRAFT_SCHEMA_VERSION),
  step: FullAiDraftStepSchema,
  idea: z.string().max(AI_IDEA_MAX_CHARACTERS),
  targetDurationSec: z.number().int().min(AI_SCRIPT_MIN_SECONDS).max(AI_SCRIPT_MAX_SECONDS),
  tone: z.string().max(200),
  skillId: SkillIdSchema.optional(),
  rankingMode: MediaRankingModeSchema,
  /**
   * Tell the story along one project video (ADR 0020); absent keeps the montage of searched media. The
   * script is what the user typed so far, possibly empty.
   */
  sourceVideo: z
    .object({
      assetId: z.string().min(1),
      volume: z.number().min(0).max(1),
      script: z.string().max(20_000).optional(),
      scriptRole: SourceScriptRoleSchema.optional(),
      hook: SourcePartSchema.optional(),
      outro: SourcePartSchema.optional(),
    })
    .optional(),
  /** The brief the questions were asked for (briefKey); "Tiếp" asks again only when it changed. */
  askedFor: z.string().max(3000).optional(),
  questions: z.array(BriefQuestionSchema).max(AI_BRIEF_MAX_QUESTIONS),
  answers: z.array(DraftAnswerSchema).max(AI_BRIEF_MAX_QUESTIONS),
  outline: DraftOutlineSchema.optional(),
  updatedAt: z.string(),
});
export type FullAiDraft = z.infer<typeof FullAiDraftSchema>;

export function newFullAiDraft(input: {
  now: string;
  rankingMode?: MediaRankingMode;
  skillId?: SkillId;
}): FullAiDraft {
  return {
    schemaVersion: FULL_AI_DRAFT_SCHEMA_VERSION,
    step: "idea",
    idea: "",
    targetDurationSec: 30,
    tone: "",
    ...(input.skillId !== undefined && { skillId: input.skillId }),
    rankingMode: input.rankingMode ?? "text",
    questions: [],
    answers: [],
    updatedAt: input.now,
  };
}

/** What the questions depend on; when it changes, the old questions no longer fit the idea. */
export function briefKey(draft: FullAiDraft, language: string): string {
  return JSON.stringify([
    normalizeWhitespace(draft.idea),
    draft.targetDurationSec,
    normalizeWhitespace(draft.tone),
    draft.skillId ?? "",
    language,
  ]);
}

/** New questions; the answers to the previous ones are dropped. */
export function setDraftQuestions(
  draft: FullAiDraft,
  suggestion: BriefQuestionsSuggestion,
  askedFor: string,
): FullAiDraft {
  return { ...draft, step: "questions", askedFor, questions: suggestion.questions, answers: [] };
}

export function draftAnswer(draft: FullAiDraft, questionId: string): DraftAnswer {
  return (
    draft.answers.find((answer) => answer.questionId === questionId) ?? {
      questionId,
      selected: [],
      otherOn: false,
      other: "",
    }
  );
}

function putAnswer(draft: FullAiDraft, answer: DraftAnswer): FullAiDraft {
  const others = draft.answers.filter((current) => current.questionId !== answer.questionId);
  return { ...draft, answers: [...others, answer] };
}

/**
 * Picks an option (index) or "Khác…" (null). A single choice replaces the previous one and picking it
 * again clears it; a multiple choice toggles.
 */
export function toggleDraftChoice(
  draft: FullAiDraft,
  questionId: string,
  option: number | null,
): FullAiDraft {
  const question = draft.questions.find((candidate) => candidate.id === questionId);
  if (!question || question.kind === "text") return draft;
  if (option !== null && (option < 0 || option >= question.options.length)) return draft;
  const answer = draftAnswer(draft, questionId);
  if (question.kind === "single") {
    const already = option === null ? answer.otherOn : answer.selected.includes(option);
    return putAnswer(draft, {
      ...answer,
      selected: already || option === null ? [] : [option],
      otherOn: !already && option === null,
    });
  }
  if (option === null) return putAnswer(draft, { ...answer, otherOn: !answer.otherOn });
  const selected = answer.selected.includes(option)
    ? answer.selected.filter((index) => index !== option)
    : [...answer.selected, option].sort((a, b) => a - b);
  return putAnswer(draft, { ...answer, selected });
}

/** The free text of a question, or of its "Khác…" choice (which it turns on). */
export function setDraftOther(draft: FullAiDraft, questionId: string, text: string): FullAiDraft {
  const question = draft.questions.find((candidate) => candidate.id === questionId);
  if (!question) return draft;
  const answer = draftAnswer(draft, questionId);
  const single = question.kind === "single";
  return putAnswer(draft, {
    ...answer,
    selected: single ? [] : answer.selected,
    otherOn: question.kind !== "text",
    other: text.slice(0, 500),
  });
}

/** The answered questions as text for the AI; unanswered ones are left to it. */
export function briefAnswers(draft: FullAiDraft): BriefAnswer[] {
  return draft.questions.flatMap((question) => {
    const answer = draftAnswer(draft, question.id);
    const parts = answer.selected.flatMap((index) => {
      const option = question.options[index];
      return option === undefined ? [] : [option];
    });
    const other = normalizeWhitespace(answer.other);
    if ((question.kind === "text" || answer.otherOn) && other !== "") parts.push(other);
    if (parts.length === 0) return [];
    return [{ question: question.text.slice(0, 300), answer: parts.join(", ").slice(0, 500) }];
  });
}

/** The AI outline as editable scenes; it replaces the previous outline. */
export function setDraftOutline(
  draft: FullAiDraft,
  suggestion: ScriptOutlineSuggestion,
  ctx: DomainContext = {},
): FullAiDraft {
  const scenes = suggestion.scenes.slice(0, 100).map((scene): OutlineScene => ({
    id: (ctx.newId ?? newId)("ols"),
    narration: scene.narration,
    visualPlan: scene.visualPlan,
    plannedNarration: scene.narration,
  }));
  return { ...draft, step: "outline", outline: { title: suggestion.title.slice(0, 300), scenes } };
}

function withScenes(draft: FullAiDraft, change: (scenes: OutlineScene[]) => OutlineScene[]): FullAiDraft {
  if (!draft.outline) return draft;
  return { ...draft, outline: { ...draft.outline, scenes: change(draft.outline.scenes) } };
}

export function editOutlineScene(draft: FullAiDraft, sceneId: string, narration: string): FullAiDraft {
  return withScenes(draft, (scenes) =>
    scenes.map((scene) => (scene.id === sceneId ? { ...scene, narration: narration.slice(0, 5000) } : scene)),
  );
}

/** An empty scene after `afterId`, or at the end when it is null. */
export function addOutlineScene(
  draft: FullAiDraft,
  afterId: string | null,
  ctx: DomainContext = {},
): FullAiDraft {
  const scene: OutlineScene = { id: (ctx.newId ?? newId)("ols"), narration: "" };
  const base = draft.outline ?? { title: "", scenes: [] };
  if (base.scenes.length >= 100) return draft;
  const index = afterId === null ? -1 : base.scenes.findIndex((candidate) => candidate.id === afterId);
  const scenes = [...base.scenes];
  scenes.splice(index === -1 ? scenes.length : index + 1, 0, scene);
  return { ...draft, outline: { ...base, scenes } };
}

export function removeOutlineScene(draft: FullAiDraft, sceneId: string): FullAiDraft {
  return withScenes(draft, (scenes) => scenes.filter((scene) => scene.id !== sceneId));
}

/** Moves a scene one place up (-1) or down (+1); a move past either end does nothing. */
export function moveOutlineScene(draft: FullAiDraft, sceneId: string, delta: -1 | 1): FullAiDraft {
  return withScenes(draft, (scenes) => {
    const index = scenes.findIndex((scene) => scene.id === sceneId);
    const target = index + delta;
    const moving = scenes[index];
    const other = scenes[target];
    if (index === -1 || !moving || !other) return scenes;
    const next = [...scenes];
    next[index] = other;
    next[target] = moving;
    return next;
  });
}

/** Estimated speaking time of one scene, at least one second for a scene with any words. */
export function outlineSceneSeconds(narration: string): number {
  const words = countWords(narration);
  return words === 0 ? 0 : Math.max(1, Math.round(words / FULL_AI_WORDS_PER_SECOND));
}

export function isLongOutlineScene(narration: string): boolean {
  return countWords(narration) > OUTLINE_LONG_SCENE_WORDS;
}

export function outlineSeconds(outline: DraftOutline): number {
  return outline.scenes.reduce((sum, scene) => sum + outlineSceneSeconds(scene.narration), 0);
}

export function isOutlineOverTarget(outline: DraftOutline, targetDurationSec: number): boolean {
  return outlineSeconds(outline) > targetDurationSec * OUTLINE_OVER_TARGET_RATIO;
}

/** The narration of every non-empty scene, one paragraph each: the outline read as a script. */
export function outlineScript(outline: DraftOutline): string {
  return outline.scenes
    .map((scene) => normalizeWhitespace(scene.narration))
    .filter((narration) => narration !== "")
    .join("\n\n");
}

/** Whether the scene's visual plan was made for its current narration (not edited since). */
export function hasCurrentVisualPlan(scene: OutlineScene): boolean {
  return (
    scene.visualPlan !== undefined &&
    scene.plannedNarration !== undefined &&
    normalizeWhitespace(scene.plannedNarration) === normalizeWhitespace(scene.narration)
  );
}

/**
 * What the run receives: empty scenes are dropped, and a visual plan is kept only while the narration
 * is still the one it was made for. Null when no scene has narration.
 */
export function toFullAiOutline(outline: DraftOutline): FullAiOutline | null {
  const scenes = outline.scenes.flatMap((scene) => {
    const narration = normalizeWhitespace(scene.narration);
    if (narration === "") return [];
    const planned = hasCurrentVisualPlan(scene);
    return [{ narration, ...(planned && scene.visualPlan && { visualPlan: scene.visualPlan }) }];
  });
  if (scenes.length === 0) return null;
  return { title: normalizeWhitespace(outline.title), scenes };
}
