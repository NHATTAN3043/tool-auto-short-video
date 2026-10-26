import type { SourceCutRequest, SourceCutSuggestion } from "../ai/schema";
import { DomainError } from "../errors";
import { newId, type DomainContext } from "../ids";
import type { ClipAnalysis } from "../media/clip-analysis";
import type { MediaAsset } from "../media/schema";
import type { Project } from "../project/schema";
import { FIT_SPEED_MAX, FIT_SPEED_MIN, fitSceneToVoice, sceneSpanMs } from "../scene/fit-speed";
import { assignMedia } from "../scene/operations";
import type { Scene } from "../scene/schema";
import { estimateSpeechMs, normalizeWhitespace } from "../text/words";
import type { SourceVideo } from "./schema";

// Full AI on one source video (ADR 0020): an optional hook, the main part told as one long scene along the
// video (more only where the content changes), and an optional call to action. Each video scene then plays
// a little faster or slower to end with its voice (ADR 0021).

/** The narration may differ from the target length by this share before the user is warned. */
const LENGTH_SLACK = 0.25;
const INTENT_MAX_LENGTH = 500;

export type SourceCutRole = "hook" | "main" | "outro";

/** One scene of the cut; `startMs`/`endMs` (and shots) only when it shows part of the source video. */
export interface SourceCutPart {
  role: SourceCutRole;
  narration: string;
  fromShot?: number;
  toShot?: number;
  startMs?: number;
  endMs?: number;
}

export interface SourceCut {
  title: string;
  /** Hook, main parts, ending: the order of the scenes. */
  parts: SourceCutPart[];
  /** Vietnamese, shown with the run's warnings. */
  warnings: string[];
}

/** The shots of an analysis as the AI is shown them. */
export function sourceCutShots(analysis: ClipAnalysis): SourceCutRequest["shots"] {
  return analysis.shots.map(({ startMs, endMs, description, textOverlay }) => ({
    startMs,
    endMs,
    description,
    textOverlay,
  }));
}

/** `12,5 giây` */
function seconds(ms: number): string {
  return `${String(Math.round(ms / 100) / 10).replace(".", ",")} giây`;
}

/** Words compared without case, accents kept, punctuation dropped: the AI may re-punctuate, not reword. */
function wordKeys(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .split(/\s+/u)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word !== "");
}

/** Whether `part` is `whole` with some words left out, nothing added or changed. */
function isSubsequence(part: readonly string[], whole: readonly string[]): boolean {
  let at = 0;
  for (const word of part) {
    while (at < whole.length && whole[at] !== word) at += 1;
    if (at === whole.length) return false;
    at += 1;
  }
  return true;
}

const refuse = (message: string) => new DomainError("AI_INVALID_OUTPUT", message);

/** A run of shots that exists, `label` naming it in the error. */
function shotRun(
  request: SourceCutRequest,
  fromShot: number | undefined,
  toShot: number | undefined,
  label: string,
) {
  const first = fromShot === undefined ? undefined : request.shots[fromShot];
  const last = toShot === undefined ? undefined : request.shots[toShot];
  if (fromShot === undefined || toShot === undefined || !first || !last || toShot < fromShot) {
    throw refuse(`${label} dùng sai đoạn video`);
  }
  return { fromShot, toShot, startMs: first.startMs, endMs: last.endMs };
}

/** The hook or the ending: needed when asked for, with words; its shots only when cut from the source. */
function extraPart(
  role: "hook" | "outro",
  asked: SourceCutRequest["hook"],
  given: SourceCutSuggestion["hook"],
  request: SourceCutRequest,
): SourceCutPart | null {
  if (!asked) return null;
  const label = role === "hook" ? "đoạn mở đầu" : "đoạn kết";
  const narration = normalizeWhitespace(given?.narration ?? "");
  if (!given || narration === "") throw refuse(`thiếu lời cho ${label}`);
  if (asked.kind === "clip") return { role, narration };
  return { role, narration, ...shotRun(request, given.fromShot, given.toShot, label) };
}

/**
 * Checks the AI's cut against the shots it was shown. Main runs out of order, overlapping or naming shots that
 * do not exist, or a missing hook or ending that was asked for, mean the AI lost track, so the whole answer is
 * refused, like a clip analysis. A hook cut from the source may repeat a moment of the main part (a teaser).
 * With the user's narration the main part may only leave words out. Length problems are warnings.
 */
export function normalizeSourceCut(data: SourceCutSuggestion, request: SourceCutRequest): SourceCut {
  let previousTo = -1;
  const main = data.main.map((run, index): SourceCutPart => {
    const part = shotRun(request, run.fromShot, run.toShot, `phần chính ${String(index + 1)}`);
    if (part.fromShot <= previousTo) throw refuse(`phần chính ${String(index + 1)} quay lại đoạn đã dùng`);
    previousTo = part.toShot;
    return { role: "main", narration: normalizeWhitespace(run.narration), ...part };
  });
  if (main.every((part) => part.narration === "")) throw refuse("phần chính không có lời đọc");
  const script = request.script;
  if (script?.role === "narration") {
    const used = wordKeys(main.map((part) => part.narration).join(" "));
    if (!isSubsequence(used, wordKeys(script.text))) {
      throw refuse("AI đã sửa lời của kịch bản thay vì giữ nguyên");
    }
  }
  const hook = extraPart("hook", request.hook, data.hook, request);
  const outro = extraPart("outro", request.outro, data.outro, request);
  const parts = [...(hook ? [hook] : []), ...main, ...(outro ? [outro] : [])];

  const warnings: string[] = [];
  // Scenes last as long as their voices, so the length of the video is about that of the narration.
  const speechMs = parts.reduce(
    (sum, part) => sum + (part.narration === "" ? 0 : estimateSpeechMs(part.narration)),
    0,
  );
  const targetMs = request.targetDurationSec * 1000;
  if (Math.abs(speechMs - targetMs) > targetMs * LENGTH_SLACK) {
    warnings.push(`Lời đọc ước tính ${seconds(speechMs)}, mục tiêu ${seconds(targetMs)}`);
  }
  for (const [index, part] of main.entries()) {
    if (part.narration === "" || part.startMs === undefined || part.endMs === undefined) continue;
    const ratio = (part.endMs - part.startMs) / estimateSpeechMs(part.narration);
    if (ratio < FIT_SPEED_MIN || ratio > FIT_SPEED_MAX) {
      warnings.push(
        `Phần chính ${String(index + 1)}: lời đọc ~${seconds(estimateSpeechMs(part.narration))} cho ${seconds(part.endMs - part.startMs)} video, có thể không khớp hết`,
      );
    }
  }
  return { title: data.title.trim(), parts, warnings };
}

/**
 * The cut as the project's scenes, in order: hook, main parts, ending. Parts of the source play their
 * stretch of it; a clip of the user plays whole (an image stays on screen with Ken Burns). Lengths are set
 * by fitSourceScenes once the voices exist. The old scenes are dropped; their assets stay in the project.
 */
export function applySourceCut(
  project: Project,
  cut: SourceCut,
  analysis: ClipAnalysis,
  source: Pick<SourceVideo, "assetId" | "volume" | "hook" | "outro">,
  ctx: DomainContext = {},
): Project {
  const findAsset = (assetId: string) => project.assets.find((candidate) => candidate.id === assetId);
  const video = findAsset(source.assetId);
  if (!video || video.kind !== "video" || video.durationMs === undefined) {
    throw new DomainError("INVALID_MEDIA", "Video nguồn không còn trong dự án");
  }
  const videoMs = video.durationMs;
  const clipOf = (part: SourceCutPart) => {
    const choice = part.role === "hook" ? source.hook : part.role === "outro" ? source.outro : undefined;
    if (choice?.kind !== "asset") return undefined;
    const asset = findAsset(choice.assetId);
    if (!asset || asset.kind === "audio") {
      throw new DomainError("INVALID_MEDIA", "Clip mở đầu/kết không còn trong dự án");
    }
    return asset;
  };

  const placed = cut.parts.flatMap((part): { part: SourceCutPart; clip: MediaAsset | undefined }[] => {
    const clip = clipOf(part);
    if (clip) return [{ part, clip }];
    if (part.startMs === undefined || part.endMs === undefined || part.startMs >= videoMs) return [];
    // Probed lengths are rounded: a stretch slightly past the file ends with it.
    return [{ part: { ...part, endMs: Math.min(part.endMs, videoMs) }, clip: undefined }];
  });
  if (!placed.some(({ part }) => part.role === "main")) {
    throw new DomainError("INVALID_MEDIA", "Các đoạn đã chọn nằm ngoài video nguồn");
  }

  const scenes = placed.map(({ part, clip }): Scene => {
    const intent = clip
      ? `${part.role === "hook" ? "Mở đầu" : "Kết"}: ${clip.fileName}`
      : analysis.shots
          .slice(part.fromShot, (part.toShot ?? -1) + 1)
          .map((shot) => shot.description.trim())
          .filter((text) => text !== "")
          .join(" · ");
    return {
      id: (ctx.newId ?? newId)("scn"),
      narration: part.narration,
      visualPlan: { intent: intent.slice(0, INTENT_MAX_LENGTH), preferredMedia: "video", searchQueries: [] },
      status: "draft",
    };
  });
  let next: Project = {
    ...project,
    script: placed
      .map(({ part }) => part.narration)
      .filter((narration) => narration !== "")
      .join("\n\n"),
    scenes,
  };
  for (const [index, scene] of scenes.entries()) {
    const entry = placed[index];
    if (!entry) continue;
    const { part, clip } = entry;
    next = clip
      ? assignMedia(next, scene.id, {
          assetId: clip.id,
          ...(clip.kind === "video" && { volume: source.volume }),
        })
      : assignMedia(next, scene.id, {
          assetId: video.id,
          sourceStartMs: part.startMs ?? 0,
          ...(part.endMs !== undefined && { sourceEndMs: part.endMs }),
          volume: source.volume,
        });
  }
  return next;
}

/**
 * Fits every video scene to its voice (fitSceneToVoice): the speed is kept within FIT_SPEED_MIN..MAX and
 * what still does not fit becomes a warning. Scenes without voice play their segment at normal speed.
 */
export function fitSourceScenes(project: Project): { project: Project; warnings: string[] } {
  let next = project;
  const warnings: string[] = [];
  for (const [index, scene] of project.scenes.entries()) {
    if (sceneSpanMs(next, scene.id) === undefined) continue;
    const { project: fitted, fit } = fitSceneToVoice(next, scene.id);
    next = fitted;
    const label = `Cảnh ${String(index + 1)}`;
    if (fit.mismatch === "voice_longer") {
      warnings.push(
        `${label}: giọng dài hơn video dù đã chậm ${String(FIT_SPEED_MIN).replace(".", ",")}×, cuối giọng bị cắt; hãy rút gọn lời`,
      );
    } else if (fit.mismatch === "voice_shorter") {
      warnings.push(
        `${label}: video dài hơn giọng dù đã nhanh ${String(FIT_SPEED_MAX).replace(".", ",")}×, cuối cảnh chỉ còn âm gốc`,
      );
    }
  }
  return { project: next, warnings };
}
