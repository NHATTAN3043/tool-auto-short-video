import { z } from "zod";

import { DomainError } from "../errors";
import {
  MAX_SHOTS,
  MIN_SHOT_MS,
  SHOT_DESCRIPTION_MAX_LENGTH,
  type ClipAnalysis,
  type ShotSpan,
} from "./clip-analysis";
import { normalizeTags } from "./media-library";

// What the AI is asked about a clip's shots and how its answer becomes a ClipAnalysis (ADR 0019).

/** Sent to the AI with one still per shot, in order. */
export interface DescribeShotsRequest {
  /** Only a hint: downloaded clips are often named after their topic. */
  fileName: string;
  durationMs: number;
  shots: readonly ShotSpan[];
}

export const ShotDescriptionSchema = z.object({
  /** 0-based, the number the still was labelled with. */
  index: z.number().int().nonnegative(),
  description: z.string(),
  tags: z.array(z.string()),
  textOverlay: z.boolean(),
});
export type ShotDescription = z.infer<typeof ShotDescriptionSchema>;

export const ShotDescriptionsSchema = z.object({ shots: z.array(ShotDescriptionSchema) });
export type ShotDescriptions = z.infer<typeof ShotDescriptionsSchema>;

/** Typical shots of a clip, for the cost shown before analyzing: real downloaded shorts average ~4s a shot. */
export function expectedShotCount(durationMs: number): number {
  return Math.min(MAX_SHOTS, Math.max(1, Math.round(durationMs / 4000)));
}

/** The most shots a clip can have, for the cost reserved against the budgets. */
export function maxShotCount(durationMs: number): number {
  return Math.min(MAX_SHOTS, Math.max(1, Math.floor(durationMs / MIN_SHOT_MS)));
}

/**
 * Joins the shots ffmpeg found with what the AI said about them. Every shot must be described exactly once:
 * a missing, extra or repeated number means the AI lost track of which still was which, and a half-right
 * analysis would put wrong moments into scenes, so the whole answer is refused.
 */
export function buildClipAnalysis(
  spans: readonly ShotSpan[],
  answer: ShotDescriptions,
  meta: { model: string; analyzedAt: string; thumbnailPaths?: readonly string[] },
): ClipAnalysis {
  const byIndex = new Map(answer.shots.map((shot) => [shot.index, shot]));
  const numbers = answer.shots.map((shot) => shot.index);
  const expected = spans.map((_, i) => i);
  const sameNumbers =
    byIndex.size === numbers.length &&
    numbers.length === expected.length &&
    expected.every((index) => byIndex.has(index));
  if (!sameNumbers) {
    throw new DomainError(
      "AI_INVALID_OUTPUT",
      `AI mô tả ${String(numbers.length)} đoạn (${numbers.join(", ")}) thay vì đủ ${String(spans.length)} đoạn`,
    );
  }
  return {
    shots: spans.map((span, index) => {
      const described = byIndex.get(index);
      const shot: ClipAnalysis["shots"][number] = {
        index,
        startMs: span.startMs,
        endMs: span.endMs,
        description: (described?.description ?? "").trim().slice(0, SHOT_DESCRIPTION_MAX_LENGTH),
        tags: normalizeTags(described?.tags ?? []),
        textOverlay: described?.textOverlay ?? false,
      };
      const thumbnailPath = meta.thumbnailPaths?.[index];
      if (thumbnailPath !== undefined) shot.thumbnailPath = thumbnailPath;
      return shot;
    }),
    model: meta.model,
    analyzedAt: meta.analyzedAt,
  };
}
