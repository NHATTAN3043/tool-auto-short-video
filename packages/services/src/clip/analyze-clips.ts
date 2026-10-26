import {
  buildClipAnalysis,
  DomainError,
  isDomainError,
  shotMiddleMs,
  shotsFromCuts,
  type LibraryMedia,
  type RenderJob,
} from "@studio/domain";

import { readStoredImage } from "../ai/rank-images";
import { libraryMediaKey } from "../media-search/import-candidate";
import { AiCallError, type AiPort, type AiResolver, type RankImage } from "../ports/ai";
import type { ClipFramesPort } from "../ports/clip-frames";
import type { Clock } from "../ports/clock";
import type { PaidPortFactory } from "../ports/cost-guard";
import type { MediaLibraryRepository } from "../ports/media-library";
import type { MediaProbePort } from "../ports/media-probe";
import type { StoragePort } from "../ports/storage";

/** Same size as `pnpm clip:shots`: enough to tell what a shot shows, small enough to stay cheap. */
export const SHOT_FRAME_MAX_SIDE = 480;

export interface AnalyzeClipsResult {
  analyzed: string[];
  skipped: string[];
  failed: { id: string; message: string }[];
  /** What the AI calls cost, failed ones the provider still billed included. */
  costUsd: number;
}

/** Vietnamese, because the job's error message is shown as is. */
function failureMessage(error: unknown): string {
  if (error instanceof AiCallError) {
    if (error.code === "AI_REFUSED") return "AI từ chối mô tả clip này";
    if (error.code === "AI_INVALID_OUTPUT") return `AI trả về kết quả không dùng được: ${error.message}`;
    return `Dịch vụ AI báo lỗi: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

const frameName = (index: number) => `frame-${String(index).padStart(3, "0")}.jpg`;

/** `shots/lib_1/job_2/frame-000.jpg` → `shots/lib_1/job_2` */
const folderOf = (relative: string) => relative.slice(0, relative.lastIndexOf("/"));

export interface AnalyzeClipDeps {
  library: MediaLibraryRepository;
  storage: StoragePort;
  frames: ClipFramesPort;
  probe: MediaProbePort;
  clock: Clock;
}

/** Re-probe old library files: their stored duration may include an audio-only tail. */
export async function readLibraryVideoDuration(
  deps: Pick<AnalyzeClipDeps, "storage" | "probe">,
  item: LibraryMedia,
): Promise<number> {
  const result = await deps.probe.probe(deps.storage.resolvePath(libraryMediaKey(item.path)));
  const durationMs = result.durationMs;
  if (result.kind !== "video" || durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 1) {
    throw new DomainError("INVALID_MEDIA", `${item.fileName}: Không đọc được thời lượng hình của video`);
  }
  return Math.round(durationMs);
}

/**
 * Cuts one library video into shots with ffmpeg, keeps a still of every shot next to the library file and
 * has the AI describe them in one call. Every billed call is reported to `onCost`, failed ones included. A
 * failure leaves no files and throws; null means the item was removed from the library meanwhile.
 */
export async function analyzeLibraryClip(
  deps: AnalyzeClipDeps,
  ai: AiPort,
  item: LibraryMedia & { durationMs: number },
  jobId: string,
  onCost: (usd: number) => void,
): Promise<LibraryMedia | null> {
  const { id } = item;
  // A folder per job, so a new analysis never overwrites the stills of the one still in use.
  const folder = `shots/${id}/${jobId}`;
  const folderKey = libraryMediaKey(folder);
  try {
    const durationMs = await readLibraryVideoDuration(deps, item);
    const source = deps.storage.resolvePath(libraryMediaKey(item.path));
    const spans = shotsFromCuts(await deps.frames.detectCuts(source), durationMs);
    await deps.frames.grabFrames(source, spans.map(shotMiddleMs), deps.storage.resolvePath(folderKey), {
      maxSide: SHOT_FRAME_MAX_SIDE,
    });
    const thumbnailPaths = spans.map((_, index) => `${folder}/${frameName(index)}`);
    const images: RankImage[] = [];
    for (const relative of thumbnailPaths) {
      const image = await readStoredImage(deps.storage, libraryMediaKey(relative));
      if (!image) throw new Error(`Không đọc được ảnh ${relative}`);
      images.push(image);
    }

    let answer;
    try {
      answer = await ai.describeShots({ fileName: item.fileName, durationMs, shots: spans }, images);
    } catch (error) {
      if (error instanceof AiCallError) onCost(error.usage?.usd ?? 0);
      throw error;
    }
    onCost(answer.usage.usd);
    const analysis = buildClipAnalysis(spans, answer.data, {
      model: ai.model,
      analyzedAt: deps.clock.now(),
      thumbnailPaths,
    });

    const previous = item.analysis?.shots[0]?.thumbnailPath;
    let analyzed: LibraryMedia;
    try {
      analyzed = await deps.library.setAnalysis(id, analysis);
    } catch (error) {
      // Removed from the library while the job ran: nothing to attach the shots to.
      if (isDomainError(error) && error.code === "LIBRARY_MEDIA_NOT_FOUND") {
        await deps.storage.removeFolder(folderKey);
        return null;
      }
      throw error;
    }
    if (previous !== undefined && folderOf(previous) !== folder) {
      await deps.storage.removeFolder(libraryMediaKey(folderOf(previous)));
    }
    return analyzed;
  } catch (error) {
    await deps.storage.removeFolder(folderKey);
    throw new Error(`${item.fileName}: ${failureMessage(error)}`, { cause: error });
  }
}

/**
 * Runs a `clip` job (ADR 0019): each library video is analyzed by analyzeLibraryClip. A clip that fails
 * leaves no files and no half analysis, and does not stop the others. Re-reads every item, since the user
 * keeps working.
 */
export function makeAnalyzeClips(
  deps: AnalyzeClipDeps & {
    /** Bound to the job, so CostGuard checks and logs each call for its project. */
    ai: PaidPortFactory<AiPort>;
    resolveAi?: (config: Parameters<AiResolver>[0]) => PaidPortFactory<AiPort>;
  },
) {
  return async (input: {
    job: RenderJob;
    onProgress?: (progress: number) => void;
  }): Promise<AnalyzeClipsResult> => {
    const { job } = input;
    const info = job.clip;
    const result: AnalyzeClipsResult = { analyzed: [], skipped: [], failed: [], costUsd: 0 };
    if (!info) return result;
    const ai = (deps.resolveAi?.(info.config) ?? deps.ai)({ projectId: job.projectId, jobId: job.id });

    for (const [position, id] of info.libraryIds.entries()) {
      const item = await deps.library.get(id).catch(() => null);
      const durationMs = item?.durationMs;
      if (
        !item ||
        item.kind !== "video" ||
        durationMs === undefined ||
        (item.analysis && info.reanalyze !== true)
      ) {
        result.skipped.push(id);
      } else {
        try {
          const analyzed = await analyzeLibraryClip(deps, ai, { ...item, durationMs }, job.id, (usd) => {
            result.costUsd += usd;
          });
          if (analyzed) result.analyzed.push(id);
          else result.skipped.push(id);
        } catch (error) {
          result.failed.push({ id, message: error instanceof Error ? error.message : String(error) });
        }
      }
      input.onProgress?.((position + 1) / info.libraryIds.length);
    }
    return result;
  };
}
