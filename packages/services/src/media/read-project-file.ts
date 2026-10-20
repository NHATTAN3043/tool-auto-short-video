import { contentTypeForFileName, DomainError, parseByteRange } from "@studio/domain";

import type { ProjectRepository } from "../ports/project-repository";
import type { StoragePort } from "../ports/storage";
import { VOICE_PREVIEW_FOLDER } from "../voice/preview-voice";

export interface ReadProjectFileInput {
  projectId: string;
  /** Path segments below the project folder, already URL-decoded, e.g. ["media", "ast_1.mp4"]. */
  path: readonly string[];
  /** Raw `Range` request header. */
  range?: string | null;
}

export type ReadProjectFileResult =
  | {
      status: 200 | 206;
      contentType: string;
      /** Media and thumbnails never change once written (new upload = new id); renders can be redone. */
      immutable: boolean;
      size: number;
      /** Inclusive byte range being sent; `end` is -1 for an empty file. */
      start: number;
      end: number;
      /** Lazy: nothing is opened until it is iterated, so a HEAD request reads no bytes. */
      body: AsyncIterable<Uint8Array>;
    }
  | { status: 416; size: number };

/** Only these project sub-folders are served; project.json and anything else stay private. */
export const SERVED_FOLDERS: readonly string[] = ["media", "thumbnails", "render", VOICE_PREVIEW_FOLDER];

const UNSAFE_SEGMENT = /[\0\\/:]/u;

function notFound(): DomainError {
  return new DomainError("FILE_NOT_FOUND", "File not found");
}

function assertSafePath(segments: readonly string[]): void {
  const [folder] = segments;
  if (segments.length < 2 || folder === undefined || !SERVED_FOLDERS.includes(folder)) throw notFound();
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === ".." || UNSAFE_SEGMENT.test(segment)) {
      throw notFound();
    }
  }
}

async function* nothing(): AsyncIterable<Uint8Array> {}

/**
 * Serves a stored project file for the browser (`<video>`, `<img>`), with HTTP Range support so media
 * can seek. Anything outside the served folders, or any path trick, is reported as not found.
 */
export function makeReadProjectFile(deps: { repo: ProjectRepository; storage: StoragePort }) {
  return async (input: ReadProjectFileInput): Promise<ReadProjectFileResult> => {
    assertSafePath(input.path);
    try {
      await deps.repo.get(input.projectId);
    } catch {
      throw notFound();
    }
    const key = `projects/${input.projectId}/${input.path.join("/")}`;
    const info = await deps.storage.stat(key).catch(() => null);
    if (!info) throw notFound();

    const range = parseByteRange(input.range, info.size);
    if (range === "invalid") return { status: 416, size: info.size };
    const { start, end } = range ?? { start: 0, end: info.size - 1 };
    return {
      status: range ? 206 : 200,
      contentType: contentTypeForFileName(input.path.at(-1) ?? ""),
      immutable: input.path[0] !== "render",
      size: info.size,
      start,
      end,
      body: info.size === 0 ? nothing() : deps.storage.read(key, { start, end }),
    };
  };
}
