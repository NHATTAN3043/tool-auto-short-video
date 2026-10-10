import {
  BudgetCheckSchema,
  ProjectSchema,
  RenderJobSchema,
  type Project,
  type RenderJob,
} from "@studio/domain";
import { z } from "zod";

import { request } from "@/features/project/api";

export const VoiceCatalogSchema = z.object({
  provider: z.string(),
  models: z.array(z.object({ id: z.string(), name: z.string(), creditsPerCharacter: z.number() })),
  voices: z.array(z.object({ id: z.string(), name: z.string(), labels: z.record(z.string(), z.string()) })),
  defaults: z
    .object({ provider: z.string(), modelId: z.string(), voiceId: z.string().optional() })
    .nullable(),
});
export type VoiceCatalog = z.infer<typeof VoiceCatalogSchema>;

export const VoiceEstimateSchema = z.object({
  sceneIds: z.array(z.string()),
  characters: z.number(),
  credits: z.number(),
  usd: z.number(),
  budget: BudgetCheckSchema,
});
export type VoiceEstimate = z.infer<typeof VoiceEstimateSchema>;

const projectBase = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;
const body = (sceneIds?: readonly string[]) => JSON.stringify(sceneIds ? { sceneIds } : {});

export function fetchVoiceCatalog(): Promise<VoiceCatalog> {
  return request("/api/voices", { method: "GET" }, VoiceCatalogSchema);
}

export function estimateVoices(projectId: string, sceneIds?: readonly string[]): Promise<VoiceEstimate> {
  return request(
    `${projectBase(projectId)}/voices/estimate`,
    { method: "POST", body: body(sceneIds) },
    VoiceEstimateSchema,
  );
}

export function requestVoices(projectId: string, sceneIds?: readonly string[]): Promise<RenderJob> {
  return request(
    `${projectBase(projectId)}/voices`,
    { method: "POST", body: body(sceneIds) },
    RenderJobSchema,
  );
}

/** All jobs of the project; voice jobs are the `tts` ones. */
export function listJobs(projectId: string): Promise<RenderJob[]> {
  return request(`${projectBase(projectId)}/renders`, { method: "GET" }, z.array(RenderJobSchema));
}

export function getJob(projectId: string, jobId: string): Promise<RenderJob> {
  return request(
    `${projectBase(projectId)}/renders/${encodeURIComponent(jobId)}`,
    { method: "GET" },
    RenderJobSchema,
  );
}

/** The stored project, to pick up the voices the worker attached. */
export function fetchProject(projectId: string): Promise<Project> {
  return request(projectBase(projectId), { method: "GET" }, ProjectSchema);
}
