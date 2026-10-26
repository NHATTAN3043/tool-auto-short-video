import {
  AiResultSchema,
  isDomainError,
  normalizeBriefQuestions,
  normalizeMediaRanking,
  normalizeScenePlan,
  normalizeSceneRewrite,
  normalizeScriptOutline,
  normalizeScriptSuggestion,
  normalizeSourceCut,
  normalizeVisualPlans,
  type AiResult,
  type AiTask,
  type RenderJob,
  type SkillGuidance,
} from "@studio/domain";

import { AiCallError, type AiPort, type AiResolver, type RankImage } from "../ports/ai";
import type { PaidPortFactory } from "../ports/cost-guard";
import type { SkillCatalogPort } from "../ports/skill-catalog";
import type { StoragePort } from "../ports/storage";
import { resolveSkill, taskLanguage, taskSkillId } from "../skill/skills";
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

async function call(
  ai: AiPort,
  task: AiTask,
  rankImages: ResolveRankImages,
  guidance: SkillGuidance | undefined,
): Promise<AiResult> {
  switch (task.type) {
    case "script": {
      const { data, usage } = await ai.generateScript(task.input, guidance);
      return { type: "script", suggestion: normalizeScriptSuggestion(data, task.input.language), usage };
    }
    case "scenes": {
      const { data, usage } = await ai.planScenes(task.input, guidance);
      return { type: "scenes", suggestion: normalizeScenePlan(data), usage };
    }
    case "visual": {
      const { data, usage } = await ai.generateVisualPlans(task.input, guidance);
      const sceneIds = task.input.scenes.map((scene) => scene.id);
      return { type: "visual", suggestion: normalizeVisualPlans(data, sceneIds), usage };
    }
    case "rank_media": {
      const { data, usage } = await ai.rankMedia(task.input, await rankImages(task.input));
      return { type: "rank_media", suggestion: normalizeMediaRanking(data, task.input), usage };
    }
    case "rewrite_scene": {
      const { data, usage } = await ai.rewriteScene(task.input, guidance);
      return {
        type: "rewrite_scene",
        suggestion: normalizeSceneRewrite(data, task.input.language),
        usage,
      };
    }
    case "brief_questions": {
      const { data, usage } = await ai.generateBriefQuestions(task.input, guidance);
      return { type: "brief_questions", suggestion: normalizeBriefQuestions(data), usage };
    }
    case "script_outline": {
      const { data, usage } = await ai.generateScriptOutline(task.input, guidance);
      return {
        type: "script_outline",
        suggestion: normalizeScriptOutline(data, task.input.language),
        usage,
      };
    }
    case "source_cut": {
      const { data, usage } = await ai.planSourceCut(task.input, guidance);
      // Checked like in a Full AI run; the answer is kept as the AI gave it, shots and all.
      normalizeSourceCut(data, task.input);
      return { type: "source_cut", suggestion: data, usage };
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
  resolveAi?: (config: Parameters<AiResolver>[0]) => PaidPortFactory<AiPort>;
  storage: StoragePort;
  /** Thumbnails for vision ranking; without it every ranking reads descriptions only. */
  rankImages?: ResolveRankImages;
  /** Installed skills; without it a task naming a skill fails. */
  skills?: SkillCatalogPort;
}) {
  return async (job: RenderJob): Promise<RunAiTaskResult> => {
    if (!job.ai) return { ok: false, message: "Job AI thiếu nội dung yêu cầu", costUsd: 0 };
    let result: AiResult;
    try {
      // Read here, not when queued: the skill file may have changed or been removed since.
      const task = job.ai.task;
      const guidance = await resolveSkill(deps.skills ?? null, taskSkillId(task), taskLanguage(task));
      const factory = deps.resolveAi?.(job.ai.config) ?? deps.ai;
      result = await call(
        factory({ projectId: job.projectId, jobId: job.id }),
        task,
        deps.rankImages ?? noImages,
        guidance,
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
