import type { RenderJob } from "@studio/domain";

import type { RunAiTaskResult } from "../ai/run-ai-task";
import type { AnalyzeClipsResult } from "../clip/analyze-clips";
import type { RunFullAiInput, RunFullAiResult } from "../full-ai/run-full-ai";
import type { Clock } from "../ports/clock";
import type { JobQueuePort, RenderJobPatch } from "../ports/job-queue";
import type { GenerateSceneVoicesInput, GenerateSceneVoicesResult } from "../voice/generate-scene-voices";
import type { NormalizeSceneVoicesInput } from "../voice/normalize-scene-voices";
import type { ExportCapcutInput, ExportCapcutResult } from "./export-capcut";
import type { RenderProjectInput, RenderProjectResult } from "./render-project";

export interface RunNextRenderJobDeps {
  queue: JobQueuePort;
  renderProject: (input: RenderProjectInput) => Promise<RenderProjectResult>;
  exportCapcut: (input: ExportCapcutInput) => Promise<ExportCapcutResult>;
  /** Null when no TTS provider is configured; `tts` jobs then fail with a clear message. */
  generateSceneVoices?: ((input: GenerateSceneVoicesInput) => Promise<GenerateSceneVoicesResult>) | null;
  /** Free loudness balancing of existing AI voices (`tts` jobs with `voice.normalizeOnly`); no TTS key needed. */
  normalizeSceneVoices?: ((input: NormalizeSceneVoicesInput) => Promise<GenerateSceneVoicesResult>) | null;
  /** Null when no AI provider is configured; `ai` jobs then fail with a clear message. */
  runAiTask?: ((job: RenderJob) => Promise<RunAiTaskResult>) | null;
  /** Null when no AI provider is configured; `full_ai` jobs then fail with a clear message. */
  runFullAi?: ((input: RunFullAiInput) => Promise<RunFullAiResult>) | null;
  /** Null when no AI provider is configured; `clip` jobs then fail with a clear message. */
  analyzeClips?:
    | ((input: { job: RenderJob; onProgress?: (progress: number) => void }) => Promise<AnalyzeClipsResult>)
    | null;
  clock: Clock;
  /** Progress is persisted at most this often, so a render does not hammer the disk. */
  progressIntervalMs?: number;
}

/**
 * Claims the oldest queued job and runs it (video, CapCut package, scene voices, AI task, Full AI or clip
 * analysis, by `kind`). Returns the finished
 * job, or null when nothing is queued.
 */
export function makeRunNextRenderJob(deps: RunNextRenderJobDeps) {
  const interval = deps.progressIntervalMs ?? 1000;

  return async (): Promise<RenderJob | null> => {
    const job = await deps.queue.claimNext();
    if (!job) return null;

    let lastWrite = Number.NEGATIVE_INFINITY;
    let pendingWrite: Promise<unknown> = Promise.resolve();
    // One chain for every intermediate write, so they never overtake each other or the final update.
    const write = (patch: RenderJobPatch, what: string) => {
      pendingWrite = pendingWrite
        .then(() => deps.queue.update(job.id, patch))
        .catch((error: unknown) => {
          console.warn(`Could not save ${what} of ${job.id}: ${String(error)}`);
        });
    };
    const onProgress = (progress: number) => {
      const now = Date.parse(deps.clock.now());
      if (now - lastWrite < interval) return;
      lastWrite = now;
      // 1 is reserved for COMPLETED, which is only set once the SRT is written too.
      write({ progress: Math.min(0.99, Math.max(0, Math.round(progress * 1000) / 1000)) }, "progress");
    };

    try {
      if (job.kind === "ai") return await runAi(job);
      if (job.kind === "full_ai") {
        const done = await runFullAi(job, onProgress, write);
        await pendingWrite;
        return await deps.queue.update(job.id, done);
      }
      if (job.kind === "clip") {
        const done = await runClips(job, onProgress);
        await pendingWrite;
        return await deps.queue.update(job.id, done);
      }
      if (job.kind === "tts") {
        await runVoices(job, onProgress);
        await pendingWrite;
        return await deps.queue.update(job.id, {
          status: "COMPLETED",
          progress: 1,
          completedAt: deps.clock.now(),
        });
      }
      const input = { projectId: job.projectId, outputName: job.id, onProgress };
      const output =
        job.kind === "capcut"
          ? await deps.exportCapcut(input).then((result) => ({ path: result.zipPath, srt: result.srtPath }))
          : await deps
              .renderProject(input)
              .then((result) => ({ path: result.videoPath, srt: result.srtPath }));
      await pendingWrite;
      return await deps.queue.update(job.id, {
        status: "COMPLETED",
        progress: 1,
        outputPath: output.path,
        srtPath: output.srt,
        completedAt: deps.clock.now(),
      });
    } catch (error) {
      await pendingWrite;
      return await deps.queue.update(job.id, {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: deps.clock.now(),
      });
    }
  };

  async function runAi(job: RenderJob): Promise<RenderJob> {
    if (!deps.runAiTask) throw new Error("Chưa cấu hình dịch vụ AI (ANTHROPIC_API_KEY) cho worker");
    const result = await deps.runAiTask(job);
    // The real cost replaces the reservation, also for failed calls the provider still billed.
    const ai = job.ai ? { ...job.ai, costUsd: result.costUsd } : undefined;
    const common = {
      progress: result.ok ? 1 : job.progress,
      completedAt: deps.clock.now(),
      ...(ai && { ai }),
    };
    return deps.queue.update(
      job.id,
      result.ok
        ? { ...common, status: "COMPLETED", outputPath: result.outputPath }
        : { ...common, status: "FAILED", errorMessage: result.message },
    );
  }

  /** Runs a Full AI job and returns its final patch; the caller writes it after pending writes. */
  async function runFullAi(
    job: RenderJob,
    onProgress: (progress: number) => void,
    write: (patch: RenderJobPatch, what: string) => void,
  ): Promise<RenderJobPatch> {
    if (!deps.runFullAi) throw new Error("Chưa cấu hình dịch vụ AI (ANTHROPIC_API_KEY) cho worker");
    const info = job.fullAi;
    let step = info?.step;
    const result = await deps.runFullAi({
      job,
      onProgress,
      // The current step is shown in the UI; it changes a handful of times, so it is written every time.
      onStep: (next) => {
        step = next;
        if (info) write({ fullAi: { ...info, step } }, "step");
      },
    });
    // The last step stays on a failed job: it is where the run stopped.
    const fullAi = info ? { ...info, ...(step && { step }), costUsd: result.costUsd } : undefined;
    const common = { completedAt: deps.clock.now(), ...(fullAi && { fullAi }) };
    return result.ok
      ? { ...common, status: "COMPLETED", progress: 1, outputPath: result.outputPath }
      : { ...common, status: "FAILED", errorMessage: result.message };
  }

  /** Runs a clip analysis job and returns its final patch. Clips analyzed before a failure stay analyzed. */
  async function runClips(job: RenderJob, onProgress: (progress: number) => void): Promise<RenderJobPatch> {
    if (!deps.analyzeClips) throw new Error("Chưa cấu hình dịch vụ AI (ANTHROPIC_API_KEY) cho worker");
    const result = await deps.analyzeClips({ job, onProgress });
    // The real cost replaces the reservation, also for failed calls the provider still billed.
    const clip = job.clip ? { ...job.clip, costUsd: result.costUsd } : undefined;
    const common = { completedAt: deps.clock.now(), ...(clip && { clip }) };
    if (result.failed.length === 0) return { ...common, status: "COMPLETED", progress: 1 };
    const first = result.failed[0]?.message ?? "";
    const total = String(job.clip?.libraryIds.length ?? 0);
    return {
      ...common,
      status: "FAILED",
      errorMessage: `Không phân tích được ${String(result.failed.length)}/${total} video: ${first}`,
    };
  }

  async function runVoices(job: RenderJob, onProgress: (progress: number) => void): Promise<void> {
    if (job.voice?.normalizeOnly === true) {
      if (!deps.normalizeSceneVoices) throw new Error("Worker chưa cấu hình cân bằng âm lượng (ffmpeg)");
      const balanced = await deps.normalizeSceneVoices({
        projectId: job.projectId,
        sceneIds: job.sceneIds ?? [],
        onProgress,
      });
      if (balanced.failed.length > 0) {
        const first = balanced.failed[0]?.message ?? "";
        throw new Error(
          `Không cân bằng được âm lượng cho ${String(balanced.failed.length)}/${String(job.sceneIds?.length ?? 0)} cảnh: ${first}`,
        );
      }
      return;
    }
    if (!deps.generateSceneVoices) {
      throw new Error("Chưa cấu hình dịch vụ tạo giọng (ELEVENLABS_API_KEY) cho worker");
    }
    const result = await deps.generateSceneVoices({
      projectId: job.projectId,
      jobId: job.id,
      sceneIds: job.sceneIds ?? [],
      ...(job.voice?.regenerate === true && { regenerate: true }),
      onProgress,
    });
    // Voices made before the failure are already saved; the job still reports what went wrong.
    if (result.failed.length > 0) {
      const first = result.failed[0]?.message ?? "";
      throw new Error(
        `Không tạo được giọng cho ${String(result.failed.length)}/${String(job.sceneIds?.length ?? 0)} cảnh: ${first}`,
      );
    }
  }
}
