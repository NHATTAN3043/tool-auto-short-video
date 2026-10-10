import {
  AiResultSchema,
  BudgetCheckSchema,
  RenderJobSchema,
  type AiResult,
  type AiTask,
  type RenderJob,
} from "@studio/domain";
import { z } from "zod";

import { request } from "@/features/project/api";

export const AiEstimateSchema = z.object({
  model: z.string(),
  inputTokens: z.number(),
  expectedOutputTokens: z.number(),
  maxOutputTokens: z.number(),
  expectedUsd: z.number(),
  maxUsd: z.number(),
  budget: BudgetCheckSchema,
});
export type AiEstimate = z.infer<typeof AiEstimateSchema>;

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export function estimateAi(projectId: string, task: AiTask): Promise<AiEstimate> {
  return request(
    `${base(projectId)}/ai/estimate`,
    { method: "POST", body: JSON.stringify({ task }) },
    AiEstimateSchema,
  );
}

export function requestAi(projectId: string, task: AiTask): Promise<RenderJob> {
  return request(
    `${base(projectId)}/ai/jobs`,
    { method: "POST", body: JSON.stringify({ task }) },
    RenderJobSchema,
  );
}

export function getAiJob(projectId: string, jobId: string): Promise<RenderJob> {
  return request(
    `${base(projectId)}/renders/${encodeURIComponent(jobId)}`,
    { method: "GET" },
    RenderJobSchema,
  );
}

export function getAiResult(projectId: string, jobId: string): Promise<AiResult> {
  return request(
    `${base(projectId)}/ai/jobs/${encodeURIComponent(jobId)}`,
    { method: "GET" },
    AiResultSchema,
  );
}
