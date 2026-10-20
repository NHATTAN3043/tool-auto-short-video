import type {
  AiTask,
  BriefQuestionsRequest,
  BriefQuestionsSuggestion,
  ContentLanguage,
  MediaRankingSuggestion,
  MediaRankRequest,
  ScenePlanRequest,
  ScenePlanSuggestion,
  SceneRewriteRequest,
  SceneRewriteSuggestion,
  ScriptOutlineRequest,
  ScriptOutlineSuggestion,
  ScriptRequest,
  ScriptSuggestion,
  SkillGuidance,
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
  estimate(task: AiTask, guidance?: SkillGuidance): Promise<AiEstimate> {
    return this.inner.estimate(task, guidance);
  }

  generateScript(input: ScriptRequest, guidance?: SkillGuidance): Promise<AiCall<ScriptSuggestion>> {
    return this.run({ type: "script", input }, () => this.inner.generateScript(input, guidance), guidance);
  }

  planScenes(input: ScenePlanRequest, guidance?: SkillGuidance): Promise<AiCall<ScenePlanSuggestion>> {
    return this.run({ type: "scenes", input }, () => this.inner.planScenes(input, guidance), guidance);
  }

  generateVisualPlans(
    input: VisualPlanRequest,
    guidance?: SkillGuidance,
  ): Promise<AiCall<VisualPlansSuggestion>> {
    return this.run(
      { type: "visual", input },
      () => this.inner.generateVisualPlans(input, guidance),
      guidance,
    );
  }

  rankMedia(
    input: MediaRankRequest,
    images: ReadonlyMap<string, RankImage>,
  ): Promise<AiCall<MediaRankingSuggestion>> {
    return this.run({ type: "rank_media", input }, () => this.inner.rankMedia(input, images));
  }

  rewriteScene(
    input: SceneRewriteRequest,
    guidance?: SkillGuidance,
  ): Promise<AiCall<SceneRewriteSuggestion>> {
    return this.run(
      { type: "rewrite_scene", input },
      () => this.inner.rewriteScene(input, guidance),
      guidance,
    );
  }

  generateBriefQuestions(
    input: BriefQuestionsRequest,
    guidance?: SkillGuidance,
  ): Promise<AiCall<BriefQuestionsSuggestion>> {
    return this.run(
      { type: "brief_questions", input },
      () => this.inner.generateBriefQuestions(input, guidance),
      guidance,
    );
  }

  generateScriptOutline(
    input: ScriptOutlineRequest,
    guidance?: SkillGuidance,
  ): Promise<AiCall<ScriptOutlineSuggestion>> {
    return this.run(
      { type: "script_outline", input },
      () => this.inner.generateScriptOutline(input, guidance),
      guidance,
    );
  }

  private async run<T>(
    task: AiTask,
    call: () => Promise<AiCall<T>>,
    guidance?: SkillGuidance,
  ): Promise<AiCall<T>> {
    // The worst case is the request's max_tokens, so the real cost can never exceed it.
    const { maxUsd } = await this.inner.estimate(task, guidance);
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

  /** Free (the provider's recorded sample); not logged. */
  voiceSample(voiceId: string): Promise<SynthesizedSpeech | null> {
    return this.inner.voiceSample(voiceId);
  }

  estimate(text: string, voice: VoiceSettings): TtsEstimate {
    return this.inner.estimate(text, voice);
  }

  synthesize(
    text: string,
    voice: VoiceSettings,
    language: ContentLanguage,
    context?: SpeechContext,
  ): Promise<SynthesizedSpeech> {
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
      run: () => this.inner.synthesize(text, voice, language, context),
      onResult: () => ({ status: "ok", usd: cost.usd, characters: cost.characters }),
      onError: failure,
    });
  }
}
