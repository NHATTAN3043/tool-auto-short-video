import "server-only";

import { isDomainError, type DomainErrorCode } from "@studio/domain";
import { NextResponse } from "next/server";
import { z } from "zod";

export interface ApiErrorBody {
  error: { code: DomainErrorCode | "INTERNAL_ERROR"; message: string };
}

const STATUS: Record<DomainErrorCode, number> = {
  INVALID_INPUT: 400,
  INVALID_PROJECT: 400,
  UNSUPPORTED_SCHEMA_VERSION: 409,
  PROJECT_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  SCENE_NOT_FOUND: 404,
  ASSET_NOT_FOUND: 422,
  SFX_NOT_FOUND: 404,
  LIBRARY_MEDIA_NOT_FOUND: 404,
  MEDIA_SEARCH_FAILED: 502,
  FILE_NOT_FOUND: 404,
  INVALID_MEDIA: 422,
  FILE_TOO_LARGE: 413,
  INVALID_OPERATION: 409,
  PROJECT_BUSY: 409,
  TTS_UNAVAILABLE: 404,
  TTS_FAILED: 502,
  AI_UNAVAILABLE: 404,
  AI_FAILED: 502,
  AI_REFUSED: 422,
  AI_INVALID_OUTPUT: 502,
  BUDGET_EXCEEDED: 402,
};

/** User-facing messages; technical details stay in the server log. */
const MESSAGES: Record<DomainErrorCode, string> = {
  INVALID_INPUT: "Dữ liệu gửi lên không hợp lệ.",
  INVALID_PROJECT: "Dữ liệu dự án không hợp lệ.",
  UNSUPPORTED_SCHEMA_VERSION: "Dự án được tạo bởi phiên bản khác của ứng dụng, chưa mở được.",
  PROJECT_NOT_FOUND: "Không tìm thấy dự án.",
  JOB_NOT_FOUND: "Không tìm thấy lượt render.",
  SCENE_NOT_FOUND: "Không tìm thấy cảnh.",
  ASSET_NOT_FOUND: "Không tìm thấy file media.",
  SFX_NOT_FOUND: "Không tìm thấy hiệu ứng âm thanh.",
  LIBRARY_MEDIA_NOT_FOUND: "Không tìm thấy media trong thư viện chung.",
  MEDIA_SEARCH_FAILED: "Không tải được media từ nguồn tìm kiếm. Vui lòng thử lại.",
  FILE_NOT_FOUND: "Không tìm thấy file.",
  INVALID_MEDIA: "File media không hợp lệ hoặc không được hỗ trợ.",
  FILE_TOO_LARGE: "File quá lớn, vượt giới hạn tải lên.",
  INVALID_OPERATION: "Không thể thực hiện thao tác này.",
  PROJECT_BUSY: "Dự án đang render hoặc chạy AI. Đợi xong rồi thử lại.",
  TTS_UNAVAILABLE: "Chưa cấu hình dịch vụ tạo giọng (ELEVENLABS_API_KEY).",
  TTS_FAILED: "Dịch vụ tạo giọng báo lỗi. Kiểm tra API key và hạn mức rồi thử lại.",
  AI_UNAVAILABLE: "Chưa cấu hình dịch vụ AI (ANTHROPIC_API_KEY hoặc OPENAI_API_KEY).",
  AI_FAILED: "Dịch vụ AI báo lỗi. Kiểm tra API key và số dư rồi thử lại.",
  AI_REFUSED: "AI từ chối yêu cầu này. Hãy diễn đạt lại.",
  AI_INVALID_OUTPUT: "AI trả về kết quả không dùng được. Vui lòng thử lại.",
  BUDGET_EXCEEDED: "Vượt ngân sách chi phí. Đổi giới hạn trong trang Cài đặt ngân sách nếu cần.",
};

/** Codes whose own message is written for the user (budgetExceededMessage): shown instead of the generic one. */
const USER_FACING = new Set<DomainErrorCode>(["BUDGET_EXCEEDED"]);

export function jsonOk<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

function errorBody(code: ApiErrorBody["error"]["code"], message: string, status: number) {
  return NextResponse.json<ApiErrorBody>({ error: { code, message } }, { status });
}

/** Maps any thrown value to a JSON error. Never leaks stack traces or internal messages to the browser. */
export function toErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (isDomainError(error)) {
    if (STATUS[error.code] >= 500) console.error(error);
    const message =
      USER_FACING.has(error.code) && error.message !== "" ? error.message : MESSAGES[error.code];
    return errorBody(error.code, message, STATUS[error.code]);
  }
  if (error instanceof z.ZodError) return errorBody("INVALID_INPUT", MESSAGES.INVALID_INPUT, 400);
  console.error(error);
  return errorBody("INTERNAL_ERROR", "Đã có lỗi xảy ra. Vui lòng thử lại.", 500);
}

/** Like parseJsonBody, but an empty body means `fallback`. */
export async function parseOptionalJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  const text = await request.text();
  if (text.trim() === "") return fallback;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new z.ZodError([{ code: "custom", message: "Body must be JSON", path: [], input: undefined }]);
  }
  return schema.parse(raw);
}

/** Reads a JSON body and validates it; a malformed body is a 400, not a 500. */
export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new z.ZodError([{ code: "custom", message: "Body must be JSON", path: [], input: undefined }]);
  }
  return schema.parse(raw);
}
