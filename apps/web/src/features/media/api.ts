import { MediaAssetSchema } from "@studio/domain";
import { z } from "zod";

import { ApiError } from "@/features/project/api";

/** What happened to the shared library copy of an uploaded video; absent for other files. */
const LibraryCopySchema = z.union([
  z.object({ itemId: z.string(), created: z.boolean() }),
  z.object({ error: z.string() }),
]);
export type LibraryCopy = z.infer<typeof LibraryCopySchema>;

const UploadResponseSchema = z.object({ asset: MediaAssetSchema, library: LibraryCopySchema.optional() });
export type UploadResult = z.infer<typeof UploadResponseSchema>;
const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** URL of a stored project file (`media/…`, `thumbnails/…`) served by the files route with Range support. */
export function projectFileUrl(projectId: string, relativePath: string): string {
  const encoded = relativePath.split("/").map(encodeURIComponent).join("/");
  return `/api/projects/${encodeURIComponent(projectId)}/files/${encoded}`;
}

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort: () => void;
}

/** Uploads one file as multipart. XHR rather than fetch, because fetch cannot report upload progress. */
export function uploadAsset(
  projectId: string,
  file: File,
  onProgress: (fraction: number) => void,
  options: { addToLibrary?: boolean } = {},
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve, reject) => {
    const query = options.addToLibrary === false ? "?library=0" : "";
    xhr.open("POST", `/api/projects/${encodeURIComponent(projectId)}/assets${query}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body: unknown = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = UploadResponseSchema.safeParse(body);
        if (parsed.success) resolve(parsed.data);
        else reject(new ApiError("INTERNAL_ERROR", "Máy chủ trả về dữ liệu không hợp lệ.", xhr.status));
        return;
      }
      const error = ApiErrorSchema.safeParse(body);
      reject(
        error.success
          ? new ApiError(error.data.error.code, error.data.error.message, xhr.status)
          : new ApiError("INTERNAL_ERROR", "Tải lên thất bại. Vui lòng thử lại.", xhr.status),
      );
    };
    xhr.onerror = () => {
      reject(new ApiError("NETWORK_ERROR", "Không kết nối được tới máy chủ.", 0));
    };
    xhr.onabort = () => {
      reject(new ApiError("ABORTED", "Đã huỷ tải lên.", 0));
    };
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
  return {
    promise,
    abort: () => {
      xhr.abort();
    },
  };
}
