import type { VoiceSettings } from "@studio/domain";

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

/** A text-to-speech provider. Paid: only called from the worker or a server route, never the browser. */
export interface TtsPort {
  /** Stored in VoiceSettings.provider. */
  readonly id: string;
  /** Models usable for this studio (Vietnamese capable), the default first. */
  readonly models: readonly TtsModel[];
  listVoices(): Promise<TtsVoice[]>;
  /** Pure estimate, no network call. */
  estimate(text: string, voice: VoiceSettings): TtsEstimate;
  synthesize(text: string, voice: VoiceSettings): Promise<SynthesizedSpeech>;
}
