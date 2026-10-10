import type {
  AiTask,
  AiUsage,
  MediaRankingSuggestion,
  MediaRankRequest,
  ScenePlanRequest,
  ScenePlanSuggestion,
  SceneRewriteRequest,
  SceneRewriteSuggestion,
  ScriptRequest,
  ScriptSuggestion,
  VisualPlanRequest,
  VisualPlansSuggestion,
} from "@studio/domain";

export interface AiEstimate {
  inputTokens: number;
  /** Typical output, thinking included. */
  expectedOutputTokens: number;
  /** The request's `max_tokens`: the call can never produce more. */
  maxOutputTokens: number;
  expectedUsd: number;
  /** Hard ceiling of the call; reserved against the daily limit while the job runs. */
  maxUsd: number;
}

export interface AiCall<T> {
  /** Schema-valid but not yet normalized. */
  data: T;
  usage: AiUsage;
}

export type AiCallErrorCode = "AI_REFUSED" | "AI_INVALID_OUTPUT" | "AI_FAILED";

/**
 * A failed AI call. `usage` is set when the model ran (refusal, truncated or invalid output), because
 * that call was still billed.
 */
export class AiCallError extends Error {
  override readonly name = "AiCallError";

  constructor(
    readonly code: AiCallErrorCode,
    message: string,
    readonly usage?: AiUsage,
  ) {
    super(message);
  }
}

/** A candidate thumbnail for vision ranking: a public HTTPS link the provider fetches, or the bytes. */
export type RankImage =
  | { type: "url"; url: string }
  | { type: "base64"; mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string };

/** A text AI provider. Paid: called only from the worker (and the free estimate from the server). */
export interface AiPort {
  readonly id: string;
  readonly model: string;
  /** Cost before running; may count tokens through the provider's free endpoint. */
  estimate(task: AiTask): Promise<AiEstimate>;
  generateScript(input: ScriptRequest): Promise<AiCall<ScriptSuggestion>>;
  planScenes(input: ScenePlanRequest): Promise<AiCall<ScenePlanSuggestion>>;
  /** One call for all scenes; `sceneId`s in the answer are those of `input.scenes`. */
  generateVisualPlans(input: VisualPlanRequest): Promise<AiCall<VisualPlansSuggestion>>;
  /**
   * Orders each scene's candidates, best first; keys in the answer are those of the request. In vision
   * mode `images` holds the thumbnails by candidate key (candidates without one are ranked by text).
   */
  rankMedia(
    input: MediaRankRequest,
    images: ReadonlyMap<string, RankImage>,
  ): Promise<AiCall<MediaRankingSuggestion>>;
  rewriteScene(input: SceneRewriteRequest): Promise<AiCall<SceneRewriteSuggestion>>;
}
