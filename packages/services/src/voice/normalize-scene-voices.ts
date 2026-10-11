import {
  DomainError,
  newId,
  scenesNeedingLoudness,
  setSceneVoice,
  type IdGenerator,
  type MediaAsset,
  type RenderJob,
} from "@studio/domain";

import type { AudioNormalizerPort } from "../ports/audio-normalizer";
import type { Clock } from "../ports/clock";
import type { JobQueuePort } from "../ports/job-queue";
import type { MediaProbePort } from "../ports/media-probe";
import type { ProjectRepository } from "../ports/project-repository";
import type { StoragePort } from "../ports/storage";
import { KeyedLock } from "../shared/keyed-lock";
import type { GenerateSceneVoicesResult } from "./generate-scene-voices";

const ACTIVE = new Set<RenderJob["status"]>(["QUEUED", "PROCESSING"]);

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `giong-canh-03.mp3` → `giong-canh-03-can-bang.mp3` */
function balancedFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${stem}-can-bang.mp3`;
}

export interface NormalizeSceneVoicesInput {
  projectId: string;
  sceneIds: readonly string[];
  /** 0..1 after each scene. */
  onProgress?: (progress: number) => void;
}

/**
 * Evens out the loudness of the AI voices already made, scene by scene, without any paid call. Each voice
 * becomes a new file and asset (same content hash, so it still matches its narration); the old file stays
 * and can be picked again. Uploaded voices and voices already balanced are skipped, and so is a scene whose
 * voice the user changed while the job ran.
 */
export function makeNormalizeSceneVoices(deps: {
  repo: ProjectRepository;
  storage: StoragePort;
  probe: MediaProbePort;
  normalizer: AudioNormalizerPort;
  clock: Clock;
  newId?: IdGenerator;
}) {
  return async (input: NormalizeSceneVoicesInput): Promise<GenerateSceneVoicesResult> => {
    const result: GenerateSceneVoicesResult = { generated: [], skipped: [], failed: [] };
    let done = 0;
    for (const sceneId of input.sceneIds) {
      done += 1;
      // Re-read every time: the user keeps editing while the job runs.
      const project = await deps.repo.get(input.projectId);
      const scene = project.scenes.find((candidate) => candidate.id === sceneId);
      const source = project.assets.find((candidate) => candidate.id === scene?.voiceAssetId);
      if (!scene || !source || scenesNeedingLoudness(project, [sceneId]).length === 0) {
        result.skipped.push(sceneId);
        input.onProgress?.(done / input.sceneIds.length);
        continue;
      }

      const assetId = (deps.newId ?? newId)("ast");
      const path = `media/${assetId}.mp3`;
      const key = `projects/${input.projectId}/${path}`;
      let written = false;
      try {
        await deps.normalizer.normalize(
          deps.storage.resolvePath(`projects/${input.projectId}/${source.path}`),
          await deps.storage.pathForWrite(key),
        );
        written = true;
        const probed = await deps.probe.probe(deps.storage.resolvePath(key));
        if (probed.kind !== "audio") throw new Error(`Normalizing produced ${probed.kind}, not audio`);

        const asset: MediaAsset = {
          id: assetId,
          kind: "audio",
          source: "tts",
          fileName: balancedFileName(source.fileName),
          path,
          ...(source.contentHash !== undefined && { contentHash: source.contentHash }),
          loudnessNormalized: true,
          createdAt: deps.clock.now(),
        };
        if (probed.durationMs !== undefined) asset.durationMs = probed.durationMs;

        const saved = await deps.repo.update(input.projectId, (stored) => {
          const current = stored.scenes.find((candidate) => candidate.id === sceneId);
          // Only replace the voice that was balanced; a voice changed meanwhile is the user's choice.
          if (current?.voiceAssetId !== source.id) return stored;
          return { ...setSceneVoice(stored, sceneId, asset), updatedAt: deps.clock.now() };
        });
        if (
          saved.scenes.some((candidate) => candidate.id === sceneId && candidate.voiceAssetId === assetId)
        ) {
          result.generated.push(sceneId);
        } else {
          await deps.storage.remove(key);
          result.skipped.push(sceneId);
        }
      } catch (error) {
        if (written) await deps.storage.remove(key);
        result.failed.push({ sceneId, message: errorMessage(error) });
      }
      input.onProgress?.(done / input.sceneIds.length);
    }
    return result;
  };
}

/**
 * Queues the free loudness job for the requested scenes (default: every scene) whose AI voice is not
 * balanced yet. An active balancing job that covers them is returned instead of queuing another.
 */
export function makeRequestVoiceLoudness(deps: {
  repo: ProjectRepository;
  queue: JobQueuePort;
  clock: Clock;
  newId?: IdGenerator;
}) {
  const lock = new KeyedLock();
  return (input: { projectId: string; sceneIds?: readonly string[] }): Promise<RenderJob> =>
    lock.run(input.projectId, async () => {
      const project = await deps.repo.get(input.projectId);
      const sceneIds = scenesNeedingLoudness(project, input.sceneIds);
      if (sceneIds.length === 0) {
        throw new DomainError("INVALID_OPERATION", "Every AI voice is already balanced");
      }
      const jobs = await deps.queue.list({ projectId: input.projectId });
      const covering = jobs.find(
        (job) =>
          job.kind === "tts" &&
          ACTIVE.has(job.status) &&
          job.voice?.normalizeOnly === true &&
          sceneIds.every((id) => job.sceneIds?.includes(id) === true),
      );
      if (covering) return covering;
      return deps.queue.enqueue({
        id: (deps.newId ?? newId)("job"),
        projectId: input.projectId,
        kind: "tts",
        sceneIds,
        voice: { normalizeOnly: true },
        status: "QUEUED",
        progress: 0,
        createdAt: deps.clock.now(),
      });
    });
}
