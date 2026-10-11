import type {
  AiTask,
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
  VoiceSettings,
} from "@studio/domain";
import {
  AiCallError,
  type AiCall,
  type AiEstimate,
  type AiPort,
  type CostGuardPort,
  type PaidCallContext,
  type PaidCallOutcome,
  type RankImage,
  type SpeechContext,
  type SynthesizedSpeech,
  type TtsEstimate,
  type TtsModel,
  type TtsPort,
  type TtsVoice,
} from "@studio/services";

// Decorators that send every paid call of a provider through CostGuard (rule 7). The composition root
// wraps the real adapter once per job, so each call is logged and counted for that project.

function failure(error: unknown): PaidCallOutcome {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof AiCallError && error.usage) {
    // Refusals and truncated or invalid answers are still billed.
    return {
      status: "failed",
      usd: error.usage.usd,
      inputTokens: error.usage.inputTokens,
      outputTokens: error.usage.outputTokens,
      message,
    };
  }
  return { status: "failed", usd: 0, message };
}

export class GuardedAi implements AiPort {
  readonly id: string;
  readonly model: string;

  constructor(
    private readonly inner: AiPort,
    private readonly guard: CostGuardPort,
    private readonly context: PaidCallContext,
  ) {
    this.id = inner.id;
    this.model = inner.model;
  }

  /** Free (token counting); not logged. */
  estimate(task: AiTask): Promise<AiEstimate> {
    return this.inner.estimate(task);
  }

  generateScript(input: ScriptRequest): Promise<AiCall<ScriptSuggestion>> {
    return this.run({ type: "script", input }, () => this.inner.generateScript(input));
  }

  planScenes(input: ScenePlanRequest): Promise<AiCall<ScenePlanSuggestion>> {
    return this.run({ type: "scenes", input }, () => this.inner.planScenes(input));
  }

  generateVisualPlans(input: VisualPlanRequest): Promise<AiCall<VisualPlansSuggestion>> {
    return this.run({ type: "visual", input }, () => this.inner.generateVisualPlans(input));
  }

  rankMedia(
    input: MediaRankRequest,
    images: ReadonlyMap<string, RankImage>,
  ): Promise<AiCall<MediaRankingSuggestion>> {
    return this.run({ type: "rank_media", input }, () => this.inner.rankMedia(input, images));
  }

  rewriteScene(input: SceneRewriteRequest): Promise<AiCall<SceneRewriteSuggestion>> {
    return this.run({ type: "rewrite_scene", input }, () => this.inner.rewriteScene(input));
  }

  private async run<T>(task: AiTask, call: () => Promise<AiCall<T>>): Promise<AiCall<T>> {
    // The worst case is the request's max_tokens, so the real cost can never exceed it.
    const { maxUsd } = await this.inner.estimate(task);
    return this.guard.guard({
      call: {
        ...this.context,
        service: "ai",
        provider: this.id,
        model: this.model,
        operation: task.type,
        maxUsd,
      },
      run: call,
      onResult: ({ usage }) => ({
        status: "ok",
        usd: usage.usd,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      }),
      onError: failure,
    });
  }
}

export class GuardedTts implements TtsPort {
  readonly id: string;
  readonly models: readonly TtsModel[];

  constructor(
    private readonly inner: TtsPort,
    private readonly guard: CostGuardPort,
    private readonly context: PaidCallContext,
  ) {
    this.id = inner.id;
    this.models = inner.models;
  }

  /** Free; not logged. */
  listVoices(): Promise<TtsVoice[]> {
    return this.inner.listVoices();
  }

  estimate(text: string, voice: VoiceSettings): TtsEstimate {
    return this.inner.estimate(text, voice);
  }

  synthesize(text: string, voice: VoiceSettings, context?: SpeechContext): Promise<SynthesizedSpeech> {
    // Billed per character, so the estimate is also the real cost; failed requests are not billed.
    const cost = this.inner.estimate(text, voice);
    return this.guard.guard({
      call: {
        ...this.context,
        service: "tts",
        provider: this.id,
        model: voice.modelId,
        operation: "speech",
        maxUsd: cost.usd,
      },
      run: () => this.inner.synthesize(text, voice, context),
      onResult: () => ({ status: "ok", usd: cost.usd, characters: cost.characters }),
      onError: failure,
    });
  }
}
