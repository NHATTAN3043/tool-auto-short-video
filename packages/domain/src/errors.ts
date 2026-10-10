export type DomainErrorCode =
  | "INVALID_INPUT"
  | "INVALID_PROJECT"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "PROJECT_NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "SCENE_NOT_FOUND"
  | "ASSET_NOT_FOUND"
  | "SFX_NOT_FOUND"
  | "LIBRARY_MEDIA_NOT_FOUND"
  | "MEDIA_SEARCH_FAILED"
  | "FILE_NOT_FOUND"
  | "INVALID_MEDIA"
  | "FILE_TOO_LARGE"
  | "INVALID_OPERATION"
  | "PROJECT_BUSY"
  | "TTS_UNAVAILABLE"
  | "TTS_FAILED"
  | "AI_UNAVAILABLE"
  | "AI_FAILED"
  | "AI_REFUSED"
  | "AI_INVALID_OUTPUT"
  | "BUDGET_EXCEEDED";

// Bundlers (Next.js server layers, test runners) can load this module more than once, which makes
// `instanceof` fail across copies. A global symbol brand identifies the error in every copy.
const BRAND = Symbol.for("studio.DomainError");

/** Expected business failure. API layers map `code` to an HTTP status and a user-facing message. */
export class DomainError extends Error {
  override readonly name = "DomainError";
  readonly [BRAND] = true;

  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return typeof error === "object" && error !== null && BRAND in error;
}
