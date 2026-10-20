import { DomainError } from "@studio/domain";

import type { SynthesizedSpeech, TtsPort } from "../ports/tts";

/** The provider's recorded sample of a voice (free), served by the web app so the browser never calls it. */
export function makeGetVoiceSample(deps: { tts: TtsPort }) {
  return async (voiceId: string): Promise<SynthesizedSpeech> => {
    let sample: SynthesizedSpeech | null;
    try {
      sample = await deps.tts.voiceSample(voiceId);
    } catch (error) {
      throw new DomainError(
        "TTS_FAILED",
        `Cannot load the voice sample: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!sample) throw new DomainError("FILE_NOT_FOUND", "This voice has no sample");
    return sample;
  };
}
