import { DomainError } from "../errors";
import type { VisualPlan } from "../scene/schema";
import { normalizeWhitespace } from "../text/words";
import {
  AI_MAX_SEARCH_QUERIES,
  type MediaRankingSuggestion,
  type MediaRankRequest,
  type ScenePlanSuggestion,
  type SceneRewriteSuggestion,
  type ScriptSuggestion,
  type VisualPlansSuggestion,
} from "./schema";

// Model output is validated by schema but still messy: stray whitespace, duplicate or empty search
// queries, empty scenes, ids it was never given. These turn it into something safe to show and apply.

const invalid = (message: string) => new DomainError("AI_INVALID_OUTPUT", message);

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

export function normalizeScriptSuggestion(suggestion: ScriptSuggestion): ScriptSuggestion {
  // Keep paragraph breaks: they are scene boundaries for the plain splitter.
  const script = suggestion.script
    .split(/\n\s*\n/u)
    .map(normalizeWhitespace)
    .filter((paragraph) => paragraph !== "")
    .join("\n\n");
  if (script === "") throw invalid("The AI returned an empty script");
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
 * keys dropped), then the candidates it left out, in their original order.
 */
export function normalizeMediaRanking(
  suggestion: MediaRankingSuggestion,
  request: MediaRankRequest,
): MediaRankingSuggestion {
  const ranked = new Map<string, readonly string[]>();
  for (const scene of suggestion.scenes) {
    if (!ranked.has(scene.sceneId)) ranked.set(scene.sceneId, scene.keys);
  }
  return {
    scenes: request.scenes.map((scene) => {
      const known = scene.candidates.map((candidate) => candidate.key);
      const allowed = new Set(known);
      const keys: string[] = [];
      for (const key of [...(ranked.get(scene.sceneId) ?? []), ...known]) {
        if (allowed.delete(key)) keys.push(key);
      }
      return { sceneId: scene.sceneId, keys };
    }),
  };
}

export function normalizeSceneRewrite(suggestion: SceneRewriteSuggestion): SceneRewriteSuggestion {
  const narration = normalizeWhitespace(suggestion.narration);
  if (narration === "") throw invalid("The AI returned an empty narration");
  return { narration };
}
