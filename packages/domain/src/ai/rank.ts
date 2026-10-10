import { candidateKey, type MediaCandidate } from "../media/search";
import type { RankCandidate } from "./schema";

/** What the AI is told about a candidate; the thumbnail is only looked at in vision mode. */
export function toRankCandidate(candidate: MediaCandidate): RankCandidate {
  return {
    key: candidateKey(candidate),
    kind: candidate.kind,
    width: candidate.width,
    height: candidate.height,
    ...(candidate.durationMs !== undefined && { durationMs: candidate.durationMs }),
    ...(candidate.description !== undefined && { description: candidate.description }),
    thumbnail: candidate.thumbnail,
  };
}

/** Candidates in the ranked order; those the ranking does not name keep their order at the end. */
export function orderByRanking(
  candidates: readonly MediaCandidate[],
  keys: readonly string[],
): MediaCandidate[] {
  const byKey = new Map(candidates.map((candidate) => [candidateKey(candidate), candidate]));
  const ranked = keys.flatMap((key) => {
    const candidate = byKey.get(key);
    if (!candidate) return [];
    byKey.delete(key);
    return [candidate];
  });
  return [...ranked, ...byKey.values()];
}
