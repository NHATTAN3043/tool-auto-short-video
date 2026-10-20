import type { ContentLanguage, VoiceSettings } from "@studio/domain";

export interface TtsVoice {
  id: string;
  name: string;
  /** Provider labels such as accent, gender, age, use case. */
  labels: Record<string, string>;
}

export interface TtsModel {
  id: string;
  name: string;
  /** Provider credits used per character of narration. */
  creditsPerCharacter: number;
}

export interface TtsEstimate {
  characters: number;
  credits: number;
  usd: number;
}

export interface SynthesizedSpeech {
  audio: Uint8Array;
  /** File extension without dot, e.g. "mp3". */
  extension: string;
}

/**
 * Narration around the text being spoken, so a voice split into scenes keeps one pace and tone. Context
 * only: it is not spoken. Providers that cannot use it ignore it.
 */
export interface SpeechContext {
  previousText?: string;
  nextText?: string;
}

/** A text-to-speech provider. Paid: only called from the worker or a server route, never the browser. */
export interface TtsPort {
  /** Stored in VoiceSettings.provider. */
  readonly id: string;
  /** Models usable for this studio (they speak every ContentLanguage), the default first. */
  readonly models: readonly TtsModel[];
  listVoices(): Promise<TtsVoice[]>;
  /**
   * The provider's own recorded sample of a voice, as it sounds with its default settings. Free; null when the
   * voice has none.
   */
  voiceSample(voiceId: string): Promise<SynthesizedSpeech | null>;
  /** Pure estimate, no network call. */
  estimate(text: string, voice: VoiceSettings): TtsEstimate;
  /** `language` is the project language, told to the provider so it does not guess from a short text. */
  synthesize(
    text: string,
    voice: VoiceSettings,
    language: ContentLanguage,
    context?: SpeechContext,
  ): Promise<SynthesizedSpeech>;
}
