import { DomainError } from "@studio/domain";

import type { TtsModel, TtsPort, TtsVoice } from "../ports/tts";

export interface TtsCatalog {
  provider: string;
  models: readonly TtsModel[];
  voices: TtsVoice[];
}

/** Voices and models the user can pick from; a provider failure becomes TTS_FAILED. */
export function makeListTtsVoices(deps: { tts: TtsPort }) {
  return async (): Promise<TtsCatalog> => {
    try {
      return { provider: deps.tts.id, models: deps.tts.models, voices: await deps.tts.listVoices() };
    } catch (error) {
      throw new DomainError(
        "TTS_FAILED",
        `Cannot list voices: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
}
