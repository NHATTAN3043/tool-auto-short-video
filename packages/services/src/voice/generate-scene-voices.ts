import {
  DomainError,
  isDomainError,
  narrationForSpeech,
  newId,
  sceneVoiceStatus,
  setSceneVoice,
  voiceContentHash,
  type IdGenerator,
  type MediaAsset,
  type Scene,
} from "@studio/domain";

import type { AudioNormalizerPort } from "../ports/audio-normalizer";
import type { Clock } from "../ports/clock";
import type { PaidPortFactory } from "../ports/cost-guard";
import type { MediaProbePort } from "../ports/media-probe";
import type { ProjectRepository } from "../ports/project-repository";
import type { StoragePort } from "../ports/storage";
import type { SpeechContext, TtsPort } from "../ports/tts";

export interface GenerateSceneVoicesDeps {
  repo: ProjectRepository;
  storage: StoragePort;
  probe: MediaProbePort;
  /** Bound to the project and job, so CostGuard checks and logs every scene's call. */
  tts: PaidPortFactory<TtsPort>;
  clock: Clock;
  /** Evens out each new voice's loudness. Null without ffmpeg: voices are stored as the provider made them. */
  normalizer?: AudioNormalizerPort | null;
  newId?: IdGenerator;
}

export interface GenerateSceneVoicesInput {
  projectId: string;
  sceneIds: readonly string[];
  /** New take even when the voice still matches or is an uploaded file; scenes without words are skipped. */
  regenerate?: boolean;
  /** The `tts` job, for the usage log. */
  jobId?: string;
  /** 0..1 after each scene. */
  onProgress?: (progress: number) => void;
}

export interface GenerateSceneVoicesResult {
  generated: string[];
  /** Deleted scenes, empty narration, uploaded voices and voices that already match. */
  skipped: string[];
  failed: { sceneId: string; message: string }[];
}

async function* bytes(data: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield data;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Narration of the scenes around `index`, so each scene is read in the pace of the whole video. */
export function speechContext(scenes: readonly Scene[], index: number): SpeechContext {
  const around = (offset: number) => narrationForSpeech(scenes[index + offset]?.narration ?? "");
  const previousText = around(-1);
  const nextText = around(1);
  return { ...(previousText !== "" && { previousText }), ...(nextText !== "" && { nextText }) };
}

/**
 * Writes the provider's audio to `key`, loudness-normalized when a normalizer is configured. The raw file is
 * a temporary sibling. A failed normalization keeps the audio as it came: it is paid for, and the scene can
 * still be balanced later. Returns whether the stored file is normalized.
 */
async function storeSpeech(deps: GenerateSceneVoicesDeps, key: string, audio: Uint8Array): Promise<boolean> {
  if (!deps.normalizer) {
    await deps.storage.write(key, bytes(audio));
    return false;
  }
  const withExtension = key.replace(/(\.[^./]+)$/u, ".raw$1");
  const rawKey = withExtension === key ? `${key}.raw` : withExtension;
  await deps.storage.write(rawKey, bytes(audio));
  try {
    await deps.normalizer.normalize(deps.storage.resolvePath(rawKey), await deps.storage.pathForWrite(key));
    return true;
  } catch {
    await deps.storage.write(key, bytes(audio));
    return false;
  } finally {
    await deps.storage.remove(rawKey);
  }
}

/**
 * Generates one voice file per scene, scene by scene. Each scene is saved as soon as it is done, so a
 * failure on one scene keeps the voices already made. Scenes whose voice still matches their narration
 * and settings are skipped: only changed scenes are paid for again. Old voice files are never touched.
 * When a budget runs out the remaining scenes fail with the same message instead of being tried.
 */
export function makeGenerateSceneVoices(deps: GenerateSceneVoicesDeps) {
  return async (input: GenerateSceneVoicesInput): Promise<GenerateSceneVoicesResult> => {
    const result: GenerateSceneVoicesResult = { generated: [], skipped: [], failed: [] };
    const tts = deps.tts({
      projectId: input.projectId,
      ...(input.jobId !== undefined && { jobId: input.jobId }),
    });
    let budgetMessage: string | null = null;
    let done = 0;
    const step = () => {
      done += 1;
      input.onProgress?.(done / input.sceneIds.length);
    };

    for (const sceneId of input.sceneIds) {
      if (budgetMessage !== null) {
        result.failed.push({ sceneId, message: budgetMessage });
        step();
        continue;
      }
      // Re-read every time: the user keeps editing while the job runs.
      const project = await deps.repo.get(input.projectId);
      const voice = project.voice;
      if (voice === undefined) {
        throw new DomainError("INVALID_OPERATION", "The project has no voice settings");
      }
      const index = project.scenes.findIndex((candidate) => candidate.id === sceneId);
      const scene = project.scenes[index];
      const status = scene ? sceneVoiceStatus(project, scene) : "empty";
      const wanted =
        input.regenerate === true ? status !== "empty" : status === "missing" || status === "outdated";
      if (!scene || !wanted) {
        result.skipped.push(sceneId);
        step();
        continue;
      }

      const assetId = (deps.newId ?? newId)("ast");
      let key: string | null = null;
      try {
        const speech = await tts.synthesize(
          narrationForSpeech(scene.narration),
          voice,
          speechContext(project.scenes, index),
        );
        const path = `media/${assetId}.${speech.extension}`;
        key = `projects/${input.projectId}/${path}`;
        const normalized = await storeSpeech(deps, key, speech.audio);
        const probed = await deps.probe.probe(deps.storage.resolvePath(key));
        if (probed.kind !== "audio") throw new Error(`The provider returned ${probed.kind}, not audio`);

        const asset: MediaAsset = {
          id: assetId,
          kind: "audio",
          source: "tts",
          fileName: `giong-canh-${String(index + 1).padStart(2, "0")}.${speech.extension}`,
          path,
          contentHash: voiceContentHash(scene.narration, voice),
          createdAt: deps.clock.now(),
          ...(normalized && { loudnessNormalized: true }),
        };
        if (probed.durationMs !== undefined) asset.durationMs = probed.durationMs;

        const saved = await deps.repo.update(input.projectId, (stored) => {
          if (!stored.scenes.some((candidate) => candidate.id === sceneId)) return stored;
          return { ...setSceneVoice(stored, sceneId, asset), updatedAt: deps.clock.now() };
        });
        if (
          saved.scenes.some((candidate) => candidate.id === sceneId && candidate.voiceAssetId === assetId)
        ) {
          result.generated.push(sceneId);
        } else {
          // The scene was deleted while its voice was being made.
          await deps.storage.remove(key);
          result.skipped.push(sceneId);
        }
      } catch (error) {
        if (key !== null) await deps.storage.remove(key);
        result.failed.push({ sceneId, message: errorMessage(error) });
        if (isDomainError(error) && error.code === "BUDGET_EXCEEDED") budgetMessage = error.message;
      }
      step();
    }
    return result;
  };
}
