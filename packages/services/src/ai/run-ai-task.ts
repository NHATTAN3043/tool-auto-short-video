import {
  AiResultSchema,
  isDomainError,
  normalizeMediaRanking,
  normalizeScenePlan,
  normalizeSceneRewrite,
  normalizeScriptSuggestion,
  normalizeVisualPlans,
  type AiResult,
  type AiTask,
  type RenderJob,
} from "@studio/domain";

import { AiCallError, type AiPort, type RankImage } from "../ports/ai";
import type { PaidPortFactory } from "../ports/cost-guard";
import type { StoragePort } from "../ports/storage";
import type { ResolveRankImages } from "./rank-images";

export type RunAiTaskResult =
  | { ok: true; outputPath: string; costUsd: number }
  /** `costUsd` is what the failed call was still billed (0 when the model never ran). */
  | { ok: false; message: string; costUsd: number };

async function* bytes(data: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield data;
}

/** Vietnamese, because the job's error message is shown as is in the UI. */
function failureMessage(error: unknown): string {
  if (error instanceof AiCallError) {
    if (error.code === "AI_REFUSED") return "AI từ chối yêu cầu này. Hãy diễn đạt lại ý tưởng hoặc script.";
    if (error.code === "AI_INVALID_OUTPUT") return `AI trả về kết quả không dùng được: ${error.message}`;
    return `Dịch vụ AI báo lỗi: ${error.message}`;
  }
  if (isDomainError(error) && error.code === "AI_INVALID_OUTPUT") {
    return `AI trả về kết quả không dùng được: ${error.message}`;
  }
  // BUDGET_EXCEEDED messages are written for the user already.
  return error instanceof Error ? error.message : String(error);
}

const noImages: ResolveRankImages = () => Promise.resolve(new Map<string, RankImage>());

async function call(ai: AiPort, task: AiTask, rankImages: ResolveRankImages): Promise<AiResult> {
  switch (task.type) {
    case "script": {
      const { data, usage } = await ai.generateScript(task.input);
      return { type: "script", suggestion: normalizeScriptSuggestion(data), usage };
    }
    case "scenes": {
      const { data, usage } = await ai.planScenes(task.input);
      return { type: "scenes", suggestion: normalizeScenePlan(data), usage };
    }
    case "visual": {
      const { data, usage } = await ai.generateVisualPlans(task.input);
      const sceneIds = task.input.scenes.map((scene) => scene.id);
      return { type: "visual", suggestion: normalizeVisualPlans(data, sceneIds), usage };
    }
    case "rank_media": {
      const { data, usage } = await ai.rankMedia(task.input, await rankImages(task.input));
      return { type: "rank_media", suggestion: normalizeMediaRanking(data, task.input), usage };
    }
    case "rewrite_scene": {
      const { data, usage } = await ai.rewriteScene(task.input);
      return { type: "rewrite_scene", suggestion: normalizeSceneRewrite(data), usage };
    }
  }
}

/**
 * Runs the AI task of a job and stores the cleaned-up suggestion as `ai/<jobId>.json` in the project.
 * Never touches the project itself: the user reviews the suggestion and applies it. `ai` is bound to the
 * job, so CostGuard checks the budgets and logs the call for this project.
 */
export function makeRunAiTask(deps: {
  ai: PaidPortFactory<AiPort>;
  storage: StoragePort;
  /** Thumbnails for vision ranking; without it every ranking reads descriptions only. */
  rankImages?: ResolveRankImages;
}) {
  return async (job: RenderJob): Promise<RunAiTaskResult> => {
    if (!job.ai) return { ok: false, message: "Job AI thiếu nội dung yêu cầu", costUsd: 0 };
    let result: AiResult;
    try {
      result = await call(
        deps.ai({ projectId: job.projectId, jobId: job.id }),
        job.ai.task,
        deps.rankImages ?? noImages,
      );
    } catch (error) {
      const costUsd = error instanceof AiCallError ? (error.usage?.usd ?? 0) : 0;
      return { ok: false, message: failureMessage(error), costUsd };
    }
    const outputPath = `ai/${job.id}.json`;
    const json = JSON.stringify(AiResultSchema.parse(result));
    await deps.storage.write(
      `projects/${job.projectId}/${outputPath}`,
      bytes(new TextEncoder().encode(json)),
    );
    return { ok: true, outputPath, costUsd: result.usage.usd };
  };
}
