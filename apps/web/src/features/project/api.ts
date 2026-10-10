import { ProjectSchema, type CreateProjectInput, type Project } from "@studio/domain";
import { z } from "zod";

// Browser-side calls to this app's own API routes. Responses are parsed, never trusted.

const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Calls one of this app's JSON routes and parses the answer; failures become an ApiError with a Vietnamese message. */
export async function request<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let res: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    res = await fetch(url, { ...init, headers });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Không kết nối được tới máy chủ.", 0);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw parsed.success
      ? new ApiError(parsed.data.error.code, parsed.data.error.message, res.status)
      : new ApiError("INTERNAL_ERROR", "Đã có lỗi xảy ra. Vui lòng thử lại.", res.status);
  }
  return schema.parse(body);
}

export function createProject(input: CreateProjectInput): Promise<Project> {
  return request("/api/projects", { method: "POST", body: JSON.stringify(input) }, ProjectSchema);
}

export function saveProject(project: Project): Promise<Project> {
  return request(
    `/api/projects/${encodeURIComponent(project.id)}`,
    { method: "PUT", body: JSON.stringify(project) },
    ProjectSchema,
  );
}

/** Deletes the project and all its files for good; the answer has no body. */
export async function deleteProject(id: string): Promise<void> {
  await request(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }, z.null());
}
