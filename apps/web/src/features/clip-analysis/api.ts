import { BudgetCheckSchema, RenderJobSchema, type RenderJob } from "@studio/domain";
import { z } from "zod";

import { request } from "@/features/project/api";

export const ClipAnalysisEstimateSchema = z.object({
  clips: z.array(
    z.object({ id: z.string(), fileName: z.string(), durationMs: z.number(), expectedShots: z.number() }),
  ),
  skipped: z.array(
    z.object({ id: z.string(), reason: z.enum(["not_found", "not_video", "analyzed", "no_duration"]) }),
  ),
  expectedUsd: z.number(),
  maxUsd: z.number(),
  model: z.string(),
  budget: BudgetCheckSchema,
});
export type ClipAnalysisEstimate = z.infer<typeof ClipAnalysisEstimateSchema>;

export interface ClipAnalysisBody {
  libraryIds: readonly string[];
  reanalyze?: boolean;
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export function estimateClipAnalysis(
  projectId: string,
  body: ClipAnalysisBody,
): Promise<ClipAnalysisEstimate> {
  return request(
    `${base(projectId)}/clip-analysis/estimate`,
    { method: "POST", body: JSON.stringify(body) },
    ClipAnalysisEstimateSchema,
  );
}

export function requestClipAnalysis(projectId: string, body: ClipAnalysisBody): Promise<RenderJob> {
  return request(
    `${base(projectId)}/clip-analysis/jobs`,
    { method: "POST", body: JSON.stringify(body) },
    RenderJobSchema,
  );
}

export function getClipJob(projectId: string, jobId: string): Promise<RenderJob> {
  return request(
    `${base(projectId)}/renders/${encodeURIComponent(jobId)}`,
    { method: "GET" },
    RenderJobSchema,
  );
}
