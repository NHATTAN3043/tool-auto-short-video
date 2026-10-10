import { RenderJobSchema, type RenderJob } from "@studio/domain";
import { z } from "zod";

import { request } from "@/features/project/api";

import type { OutputKind } from "./jobs";

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/renders`;

export function requestRender(projectId: string, kind: OutputKind = "video"): Promise<RenderJob> {
  return request(base(projectId), { method: "POST", body: JSON.stringify({ kind }) }, RenderJobSchema);
}

export function listRenders(projectId: string): Promise<RenderJob[]> {
  return request(base(projectId), { method: "GET" }, z.array(RenderJobSchema));
}

export function getRender(projectId: string, jobId: string): Promise<RenderJob> {
  return request(`${base(projectId)}/${encodeURIComponent(jobId)}`, { method: "GET" }, RenderJobSchema);
}
