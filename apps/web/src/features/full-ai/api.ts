import {
  BudgetCheckSchema,
  FullAiDraftSchema,
  FullAiResultSchema,
  FullAiStepSchema,
  RenderJobSchema,
  type FullAiDraft,
  type FullAiRequest,
  type FullAiResult,
  type RenderJob,
} from "@studio/domain";
import { z } from "zod";

import { request } from "@/features/project/api";

export const FullAiEstimateSchema = z.object({
  steps: z.array(FullAiStepSchema),
  costs: z.array(z.object({ step: FullAiStepSchema, expectedUsd: z.number(), maxUsd: z.number() })),
  sceneCount: z.number(),
  expectedUsd: z.number(),
  maxUsd: z.number(),
  budget: BudgetCheckSchema,
});
export type FullAiEstimate = z.infer<typeof FullAiEstimateSchema>;

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export function estimateFullAi(projectId: string, body: FullAiRequest): Promise<FullAiEstimate> {
  return request(
    `${base(projectId)}/full-ai/estimate`,
    { method: "POST", body: JSON.stringify({ request: body }) },
    FullAiEstimateSchema,
  );
}

export function requestFullAi(projectId: string, body: FullAiRequest): Promise<RenderJob> {
  return request(
    `${base(projectId)}/full-ai/jobs`,
    { method: "POST", body: JSON.stringify({ request: body }) },
    RenderJobSchema,
  );
}

export function getFullAiJob(projectId: string, jobId: string): Promise<RenderJob> {
  return request(
    `${base(projectId)}/renders/${encodeURIComponent(jobId)}`,
    { method: "GET" },
    RenderJobSchema,
  );
}

export function listProjectJobs(projectId: string): Promise<RenderJob[]> {
  return request(`${base(projectId)}/renders`, { method: "GET" }, z.array(RenderJobSchema));
}

export function getFullAiResult(projectId: string, jobId: string): Promise<FullAiResult> {
  return request(
    `${base(projectId)}/full-ai/jobs/${encodeURIComponent(jobId)}`,
    { method: "GET" },
    FullAiResultSchema,
  );
}

const DraftBodySchema = z.object({ draft: FullAiDraftSchema.nullable() });

/** The Full AI draft of the project (ADR 0015), or null when there is none. */
export async function getFullAiDraft(projectId: string): Promise<FullAiDraft | null> {
  return (await request(`${base(projectId)}/full-ai/draft`, { method: "GET" }, DraftBodySchema)).draft;
}

export async function saveFullAiDraft(projectId: string, draft: FullAiDraft): Promise<FullAiDraft> {
  const saved = await request(
    `${base(projectId)}/full-ai/draft`,
    { method: "PUT", body: JSON.stringify({ draft }) },
    z.object({ draft: FullAiDraftSchema }),
  );
  return saved.draft;
}

/** Starts over; the answer has no body. */
export async function deleteFullAiDraft(projectId: string): Promise<void> {
  await request(`${base(projectId)}/full-ai/draft`, { method: "DELETE" }, z.null());
}
