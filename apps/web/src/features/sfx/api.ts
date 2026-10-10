import { LibrarySfxSchema, MediaAssetSchema, type LibrarySfx, type MediaAsset } from "@studio/domain";
import { z } from "zod";

import { ApiError, request } from "@/features/project/api";

// Browser-side calls for the shared sound effect library. Responses are parsed, never trusted.

const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** Audio file of a library effect, for listening before picking it. */
export function sfxFileUrl(id: string): string {
  return `/api/sfx/${encodeURIComponent(id)}/file`;
}

export function listSfx(): Promise<LibrarySfx[]> {
  return request("/api/sfx", { method: "GET" }, z.array(LibrarySfxSchema));
}

/** Effects are small, so a plain fetch without progress is enough. */
export async function uploadSfx(file: File): Promise<LibrarySfx> {
  const form = new FormData();
  form.append("file", file, file.name);
  let res: Response;
  try {
    res = await fetch("/api/sfx", { method: "POST", body: form });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Không kết nối được tới máy chủ.", 0);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw parsed.success
      ? new ApiError(parsed.data.error.code, parsed.data.error.message, res.status)
      : new ApiError("INTERNAL_ERROR", "Tải lên thất bại. Vui lòng thử lại.", res.status);
  }
  return LibrarySfxSchema.parse(body);
}

export function renameSfx(id: string, name: string): Promise<LibrarySfx> {
  return request(
    `/api/sfx/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
    LibrarySfxSchema,
  );
}

export async function deleteSfx(id: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/sfx/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Không kết nối được tới máy chủ.", 0);
  }
  if (!res.ok) throw new ApiError("INTERNAL_ERROR", "Không xoá được hiệu ứng.", res.status);
}

/** Copies a library effect into the project (once) and returns the project's audio asset. */
export async function copySfxToProject(projectId: string, sfxId: string): Promise<MediaAsset> {
  const { asset } = await request(
    `/api/projects/${encodeURIComponent(projectId)}/sfx`,
    { method: "POST", body: JSON.stringify({ sfxId }) },
    z.object({ asset: MediaAssetSchema }),
  );
  return asset;
}
