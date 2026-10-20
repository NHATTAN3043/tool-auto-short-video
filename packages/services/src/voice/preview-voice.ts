import {
  DomainError,
  isDomainError,
  narrationForSpeech,
  VOICE_PREVIEW_MAX_CHARACTERS,
  voiceContentHash,
  type ContentLanguage,
  type VoiceSettings,
} from "@studio/domain";

import type { PaidPortFactory } from "../ports/cost-guard";
import type { ProjectRepository } from "../ports/project-repository";
import type { StoragePort } from "../ports/storage";
import type { TtsPort } from "../ports/tts";

/** Project sub-folder of the previews; served by readProjectFile, not part of the Project model. */
export const VOICE_PREVIEW_FOLDER = "voice-previews";

export interface PreviewVoiceInput {
  projectId: string;
  text: string;
  /** The settings shown in the editor, which autosave may not have stored yet. */
  voice: VoiceSettings;
  language: ContentLanguage;
}

export interface PreviewVoiceResult {
  /** Below the project folder, e.g. "voice-previews/0123abcd.mp3". */
  path: string;
  /** True when the same text, settings and language were heard before: nothing was paid. */
  cached: boolean;
}

async function* bytes(data: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield data;
}

/**
 * Speaks a short sentence with the given voice settings, so the user hears speed, stability, model and
 * language before voicing every scene. Runs inside the request (ADR 0014); the file is cached by content
 * hash, so hearing the same preview again is free. Never touches the project or its scene voices.
 */
export function makePreviewVoice(deps: {
  repo: ProjectRepository;
  storage: StoragePort;
  /** Wrapped in CostGuard by the composition root (rule 7). */
  tts: PaidPortFactory<TtsPort>;
}) {
  return async (input: PreviewVoiceInput): Promise<PreviewVoiceResult> => {
    const text = narrationForSpeech(input.text);
    if (text === "" || text.length > VOICE_PREVIEW_MAX_CHARACTERS) {
      throw new DomainError(
        "INVALID_INPUT",
        `Preview text must be 1-${String(VOICE_PREVIEW_MAX_CHARACTERS)} characters`,
      );
    }
    const project = await deps.repo.get(input.projectId);
    const tts = deps.tts({ projectId: project.id });
    if (input.voice.provider !== tts.id) {
      throw new DomainError("INVALID_OPERATION", `Voice provider ${input.voice.provider} is not configured`);
    }

    const hash = voiceContentHash(text, input.voice, input.language).replace(/^tts1:/u, "");
    const path = `${VOICE_PREVIEW_FOLDER}/${hash}.mp3`;
    const key = `projects/${project.id}/${path}`;
    if (await deps.storage.exists(key)) return { path, cached: true };

    let audio: Uint8Array;
    try {
      ({ audio } = await tts.synthesize(text, input.voice, input.language));
    } catch (error) {
      if (isDomainError(error)) throw error;
      throw new DomainError(
        "TTS_FAILED",
        `Cannot preview the voice: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await deps.storage.write(key, bytes(audio));
    return { path, cached: false };
  };
}
