import { DomainError } from "../errors";
import type { VisualPlan } from "../scene/schema";
import { DEFAULT_CONTENT_LANGUAGE, matchesLanguage, type ContentLanguage } from "../text/language";
import { normalizeWhitespace } from "../text/words";
import {
  AI_BRIEF_MAX_OPTIONS,
  AI_BRIEF_MAX_QUESTIONS,
  AI_MAX_SEARCH_QUERIES,
  type BriefQuestion,
  type BriefQuestionsSuggestion,
  type MediaRankingSuggestion,
  type MediaRankRequest,
  type ScenePlanSuggestion,
  type SceneRewriteSuggestion,
  type ScriptOutlineSuggestion,
  type ScriptSuggestion,
  type VisualPlansSuggestion,
} from "./schema";

// Model output is validated by schema but still messy: stray whitespace, duplicate or empty search
// queries, empty scenes, ids it was never given. These turn it into something safe to show and apply.

const invalid = (message: string) => new DomainError("AI_INVALID_OUTPUT", message);

/** Shown to the user as is: English narration never reaches a Vietnamese video. */
export const NOT_VIETNAMESE_MESSAGE =
  "AI viết lời đọc không phải tiếng Việt nên kết quả bị bỏ, dự án không đổi. Hãy chạy lại hoặc dùng skill có bản tiếng Việt (SKILL.vi.md).";

/** Shown to the user as is: Vietnamese narration never reaches an English video. */
export const NOT_ENGLISH_MESSAGE =
  "AI viết lời đọc không phải tiếng Anh nên kết quả bị bỏ, dự án không đổi. Hãy chạy lại, viết ý tưởng rõ hơn hoặc đổi ngôn ngữ dự án.";

function assertLanguage(text: string, language: ContentLanguage): void {
  if (!matchesLanguage(text, language)) {
    throw invalid(language === "vi" ? NOT_VIETNAMESE_MESSAGE : NOT_ENGLISH_MESSAGE);
  }
}

/** Trims, drops empty and duplicate (case-insensitive) queries and keeps at most AI_MAX_SEARCH_QUERIES. */
export function normalizeQueries(queries: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of queries) {
    const query = normalizeWhitespace(raw);
    const key = query.toLocaleLowerCase();
    if (query === "" || seen.has(key)) continue;
    seen.add(key);
    result.push(query);
    if (result.length === AI_MAX_SEARCH_QUERIES) break;
  }
  return result;
}

export function normalizeVisualPlan(plan: VisualPlan): VisualPlan {
  const next: VisualPlan = {
    intent: normalizeWhitespace(plan.intent),
    preferredMedia: plan.preferredMedia,
    searchQueries: normalizeQueries(plan.searchQueries),
  };
  if (plan.localizedQueries) {
    next.localizedQueries = {
      vi: normalizeQueries(plan.localizedQueries.vi),
      zh: normalizeQueries(plan.localizedQueries.zh),
    };
  }
  return next;
}

export function normalizeScriptSuggestion(
  suggestion: ScriptSuggestion,
  language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE,
): ScriptSuggestion {
  // Keep paragraph breaks: they are scene boundaries for the plain splitter.
  const script = suggestion.script
    .split(/\n\s*\n/u)
    .map(normalizeWhitespace)
    .filter((paragraph) => paragraph !== "")
    .join("\n\n");
  if (script === "") throw invalid("The AI returned an empty script");
  assertLanguage(script, language);
  return { title: normalizeWhitespace(suggestion.title), script };
}

export function normalizeScenePlan(suggestion: ScenePlanSuggestion): ScenePlanSuggestion {
  const scenes = suggestion.scenes
    .map((scene) => ({
      narration: normalizeWhitespace(scene.narration),
      visualPlan: normalizeVisualPlan(scene.visualPlan),
    }))
    .filter((scene) => scene.narration !== "");
  if (scenes.length === 0) throw invalid("The AI returned no scenes");
  return { scenes };
}

/** Keeps one plan per scene that was asked about, in the order of `sceneIds`. */
export function normalizeVisualPlans(
  suggestion: VisualPlansSuggestion,
  sceneIds: readonly string[],
): VisualPlansSuggestion {
  const byScene = new Map<string, VisualPlan>();
  for (const plan of suggestion.plans) {
    if (!byScene.has(plan.sceneId)) byScene.set(plan.sceneId, normalizeVisualPlan(plan.visualPlan));
  }
  const plans = sceneIds.flatMap((sceneId) => {
    const visualPlan = byScene.get(sceneId);
    return visualPlan ? [{ sceneId, visualPlan }] : [];
  });
  if (plans.length === 0) throw invalid("The AI returned no plan for the requested scenes");
  return { plans };
}

/**
 * A full order of every candidate for each requested scene: the AI's order first (unknown and repeated
 * keys dropped), then the candidates it left out, in their original order, then the ones it rejected as
 * not fitting the scene (unknown rejected keys dropped).
 */
export function normalizeMediaRanking(
  suggestion: MediaRankingSuggestion,
  request: MediaRankRequest,
): MediaRankingSuggestion {
  const ranked = new Map<string, MediaRankingSuggestion["scenes"][number]>();
  for (const scene of suggestion.scenes) {
    if (!ranked.has(scene.sceneId)) ranked.set(scene.sceneId, scene);
  }
  return {
    scenes: request.scenes.map((scene) => {
      const known = scene.candidates.map((candidate) => candidate.key);
      const answer = ranked.get(scene.sceneId);
      const rejected = known.filter((key) => answer?.rejected?.includes(key) === true);
      const allowed = new Set(known.filter((key) => !rejected.includes(key)));
      const keys: string[] = [];
      for (const key of [...(answer?.keys ?? []), ...known]) {
        if (allowed.delete(key)) keys.push(key);
      }
      return rejected.length === 0
        ? { sceneId: scene.sceneId, keys }
        : { sceneId: scene.sceneId, keys: [...keys, ...rejected], rejected };
    }),
  };
}

export function normalizeSceneRewrite(
  suggestion: SceneRewriteSuggestion,
  language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE,
): SceneRewriteSuggestion {
  const narration = normalizeWhitespace(suggestion.narration);
  if (narration === "") throw invalid("The AI returned an empty narration");
  assertLanguage(narration, language);
  return { narration };
}

/** Trimmed, distinct (case-insensitive) and non-empty, at most `max`. */
function distinct(values: readonly string[], max: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = normalizeWhitespace(raw);
    const key = value.toLocaleLowerCase();
    if (value === "" || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length === max) break;
  }
  return result;
}

/**
 * Clean questions with stable ids `q1`, `q2`…: empty ones dropped, options cleaned, and a choice with
 * fewer than two options asked as free text instead. No questions is a valid answer.
 */
export function normalizeBriefQuestions(suggestion: BriefQuestionsSuggestion): BriefQuestionsSuggestion {
  const questions: BriefQuestion[] = [];
  for (const question of suggestion.questions) {
    const text = normalizeWhitespace(question.text).slice(0, 300);
    if (text === "") continue;
    const options =
      question.kind === "text"
        ? []
        : distinct(question.options, AI_BRIEF_MAX_OPTIONS).map((option) => option.slice(0, 120));
    const kind = options.length < 2 ? "text" : question.kind;
    questions.push({
      id: `q${String(questions.length + 1)}`,
      text,
      kind,
      options: kind === "text" ? [] : options,
    });
    if (questions.length === AI_BRIEF_MAX_QUESTIONS) break;
  }
  return { questions };
}

/** A scene plan with a title, whose narration must be in the video's language. */
export function normalizeScriptOutline(
  suggestion: ScriptOutlineSuggestion,
  language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE,
): ScriptOutlineSuggestion {
  const { scenes } = normalizeScenePlan(suggestion);
  assertLanguage(scenes.map((scene) => scene.narration).join("\n"), language);
  return { title: normalizeWhitespace(suggestion.title), scenes };
}
