import { candidateKey, type MediaCandidate } from "../media/search";
import type { Scene } from "../scene/schema";
import type { MissingScene, MissingSceneReason } from "./schema";

/** What the media and rank steps found for one scene. */
export interface SceneMediaOutcome {
  candidates: readonly MediaCandidate[];
  /** Candidate keys the AI said do not fit. */
  rejected: ReadonlySet<string>;
}

function reasonFor(outcome: SceneMediaOutcome | undefined): MissingSceneReason {
  if (!outcome || outcome.candidates.length === 0) return "no_candidates";
  return outcome.candidates.every((candidate) => outcome.rejected.has(candidateKey(candidate)))
    ? "all_rejected"
    : "not_assigned";
}

/**
 * The scenes still without media after a Full AI run, in scene order, with what to look for: the visual
 * intent and the keywords in three languages, ready to search elsewhere.
 */
export function missingScenes(
  scenes: readonly Scene[],
  outcomes: ReadonlyMap<string, SceneMediaOutcome>,
): MissingScene[] {
  return scenes
    .filter((scene) => scene.media === undefined)
    .map((scene) => ({
      sceneId: scene.id,
      reason: reasonFor(outcomes.get(scene.id)),
      intent: scene.visualPlan?.intent ?? "",
      queries: {
        en: scene.visualPlan?.searchQueries ?? [],
        vi: scene.visualPlan?.localizedQueries?.vi ?? [],
        zh: scene.visualPlan?.localizedQueries?.zh ?? [],
      },
    }));
}
