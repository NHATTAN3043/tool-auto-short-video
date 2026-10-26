import {
  AI_SCRIPT_MAX_SECONDS,
  AI_SCRIPT_MIN_SECONDS,
  briefAnswers,
  FULL_AI_STEP_LABELS,
  formatUsd,
  isOutlineOverTarget,
  newFullAiDraft,
  outlineScript,
  outlineSeconds,
  sceneVoiceStatus,
  toFullAiOutline,
  type AiTask,
  type FullAiDraft,
  type FullAiDraftStep,
  type FullAiRequest,
  type FullAiResult,
  type FullAiStep,
  type MediaAsset,
  type MediaCandidate,
  type MediaRankingMode,
  type MissingScene,
  type MissingSceneReason,
  type Project,
  type RenderJob,
  type AutomationSettings,
  type ContentLanguage,
  type SkillId,
  type SkillSummary,
  type SourcePart,
} from "@studio/domain";

import type { FullAiEstimate } from "./api";

// Pure rules of the Full AI page (ADR 0015) and the review screen.

export const FULL_AI_POLL_INTERVAL_MS = 2000;

export const FULL_AI_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

export const RANKING_MODE_LABELS: Record<MediaRankingMode, { title: string; description: string }> = {
  text: { title: "Theo mô tả", description: "AI đọc mô tả và tag của từng media. Rẻ." },
  vision: {
    title: "Xem ảnh",
    description: "AI nhìn thumbnail của từng media. Chính xác hơn, tốn gấp nhiều lần.",
  },
};

/** The skill chosen last, while it is still installed. */
export function rememberedSkill(project: Project, skills: readonly SkillSummary[]): SkillId | undefined {
  const id = project.aiSkillId;
  return id !== undefined && skills.some((skill) => skill.id === id) ? id : undefined;
}

/** Whether a run makes an AI call the skill is sent with: script, AI scene planning, keywords or the cut. */
export function runUsesSkill(steps: readonly FullAiStep[], settings: AutomationSettings): boolean {
  return (
    steps.includes("script") ||
    steps.includes("cut") ||
    steps.includes("visual") ||
    (steps.includes("scenes") && settings.scenePlanning)
  );
}

/** Under the picker: what the chosen skill does, and the language guard of the project language. */
export function skillHint(skill: SkillSummary | undefined, language: ContentLanguage = "vi"): string {
  if (!skill) return "Không gửi kèm skill.";
  if (language === "en") {
    return "Dự án tiếng Anh: gửi bản SKILL.md nếu có; lời đọc không phải tiếng Anh sẽ bị bỏ, dự án không đổi.";
  }
  return skill.language === "vi"
    ? "Bản tiếng Việt (SKILL.vi.md)."
    : "Skill tiếng Anh: AI vẫn phải viết tiếng Việt; lời đọc không phải tiếng Việt sẽ bị bỏ, dự án không đổi.";
}

/** Asking first and the outline need the AI to write the script (ADR 0015). */
export function canAskFirst(project: Project): boolean {
  return project.automationSettings.scriptGeneration;
}

/** A fresh draft from what the project remembers. */
export function initialDraft(project: Project, skills: readonly SkillSummary[], now: string): FullAiDraft {
  const skillId = rememberedSkill(project, skills);
  return newFullAiDraft({
    now,
    rankingMode: project.mediaRankingMode ?? "text",
    ...(skillId !== undefined && { skillId }),
  });
}

/** A saved draft whose skill was removed since runs without it. */
export function withInstalledSkill(draft: FullAiDraft, skills: readonly SkillSummary[]): FullAiDraft {
  if (draft.skillId === undefined || skills.some((skill) => skill.id === draft.skillId)) return draft;
  const next = { ...draft };
  delete next.skillId;
  return next;
}

/** Whole seconds of a source video, within the target limits: offered as "Theo video gốc". */
export function sourceSeconds(video: Pick<MediaAsset, "durationMs">): number {
  return Math.min(AI_SCRIPT_MAX_SECONDS, Math.floor((video.durationMs ?? 0) / 1000));
}

/** Project videos a run can follow: uploaded with a length and a hash. */
export function sourceVideos(project: Project): MediaAsset[] {
  return project.assets.filter(
    (asset) =>
      asset.kind === "video" &&
      asset.contentHash !== undefined &&
      sourceSeconds(asset) >= AI_SCRIPT_MIN_SECONDS,
  );
}

/** Videos and images that can open or close a source run: every one but the source itself. */
export function sourceClips(project: Project, sourceAssetId: string): MediaAsset[] {
  return project.assets.filter(
    (asset) =>
      asset.id !== sourceAssetId &&
      (asset.kind === "image" || (asset.kind === "video" && asset.durationMs !== undefined)),
  );
}

/**
 * Target lengths offered on a source video: the usual ones and the video's own length. The target is the
 * whole short, so it may be longer than the video when there is a hook or an ending.
 */
export function sourceDurations(videoSeconds: number): number[] {
  return [...new Set([...FULL_AI_DURATIONS, videoSeconds])].sort((a, b) => a - b);
}

/** A length typed in "Tự nhập…": whole seconds above 0 and below 1000. */
export function parseDuration(text: string): { seconds: number } | { error: string } {
  const trimmed = text.trim();
  const seconds = /^\d+$/u.test(trimmed) ? Number(trimmed) : Number.NaN;
  return seconds >= AI_SCRIPT_MIN_SECONDS && seconds <= AI_SCRIPT_MAX_SECONDS
    ? { seconds }
    : { error: "Nhập số giây nguyên, lớn hơn 0 và nhỏ hơn 1000." };
}

/** The draft following `video`; the hook, the ending and the script chosen so far are kept. */
export function withSourceVideo(draft: FullAiDraft, video: MediaAsset): FullAiDraft {
  return { ...draft, sourceVideo: { volume: 0.2, ...draft.sourceVideo, assetId: video.id } };
}

/** The hook or ending as the request takes it; "none" is the same as leaving it out. */
const sourcePart = (part: SourcePart | undefined) =>
  part === undefined || part.kind === "none" ? undefined : part;

/** The draft's source video as the request takes it; the script only when something was typed. */
function sourceRequest(draft: FullAiDraft): FullAiRequest["sourceVideo"] {
  const source = draft.sourceVideo;
  if (!source) return undefined;
  const text = source.script?.trim() ?? "";
  const hook = sourcePart(source.hook);
  const outro = sourcePart(source.outro);
  return {
    assetId: source.assetId,
    volume: source.volume,
    ...(text !== "" && { script: { text, role: source.scriptRole ?? "reference" } }),
    ...(hook && { hook }),
    ...(outro && { outro }),
  };
}

/** Why the first step cannot go on yet, or null. Mirrors assertFullAiRequest so the button explains itself. */
export function ideaError(draft: FullAiDraft, project: Project): string | null {
  const source = draft.sourceVideo;
  if (source) {
    const video = sourceVideos(project).find((candidate) => candidate.id === source.assetId);
    if (!video) return "Chọn video nguồn.";
    const clips = sourceClips(project, video.id);
    for (const [part, name] of [
      [source.hook, "mở đầu"],
      [source.outro, "kết"],
    ] as const) {
      if (part?.kind === "asset" && !clips.some((clip) => clip.id === part.assetId)) {
        return `Clip ${name} không còn trong dự án, hãy chọn lại.`;
      }
    }
    return draft.idea.trim().length < 3 && (source.script?.trim() ?? "") === ""
      ? "Nhập yêu cầu (ít nhất 3 ký tự) hoặc dán kịch bản / sub của video."
      : null;
  }
  if (canAskFirst(project)) {
    return draft.idea.trim().length < 3 ? "Nhập ý tưởng (ít nhất 3 ký tự)." : null;
  }
  return project.script.trim() === ""
    ? "Viết script trước, hoặc bật “Viết script” trong cài đặt dự án để AI viết từ ý tưởng."
    : null;
}

function briefInput(draft: FullAiDraft, language: ContentLanguage) {
  const tone = draft.tone.trim();
  return {
    idea: draft.idea.trim(),
    targetDurationSec: draft.targetDurationSec,
    ...(tone !== "" && { tone }),
    ...(draft.skillId !== undefined && { skillId: draft.skillId }),
    language,
  };
}

/** "Tiếp: AI hỏi lại". The server fills the language again from the project. */
export function briefTask(draft: FullAiDraft, language: ContentLanguage): AiTask {
  return { type: "brief_questions", input: briefInput(draft, language) };
}

/** The outline from the answers; with feedback, a revision of the current outline. */
export function outlineTask(draft: FullAiDraft, language: ContentLanguage, feedback?: string): AiTask {
  const note = feedback?.trim() ?? "";
  const previous = (draft.outline?.scenes ?? [])
    .map((scene) => scene.narration.trim())
    .filter((narration) => narration !== "");
  return {
    type: "script_outline",
    input: {
      ...briefInput(draft, language),
      answers: briefAnswers(draft),
      ...(note !== "" &&
        previous.length > 0 && { revision: { feedback: note.slice(0, 500), scenes: previous } }),
    },
  };
}

/** "Viết lại" one scene of the outline, with the whole outline as context; null for an empty scene. */
export function rewriteTask(draft: FullAiDraft, sceneId: string, language: ContentLanguage): AiTask | null {
  const scene = draft.outline?.scenes.find((candidate) => candidate.id === sceneId);
  if (!draft.outline || !scene || scene.narration.trim() === "") return null;
  return {
    type: "rewrite_scene",
    input: {
      script: outlineScript(draft.outline).slice(0, 20_000),
      narration: scene.narration.trim(),
      ...(draft.skillId !== undefined && { skillId: draft.skillId }),
      language,
    },
  };
}

/**
 * "Chạy luôn, không hỏi": the run of before ADR 0015, from the idea (or the project's script). The skill
 * goes only when a step sends it.
 */
export function quickRequest(
  draft: FullAiDraft,
  project: Project,
  steps: readonly FullAiStep[],
  language: ContentLanguage,
): FullAiRequest {
  const idea = draft.idea.trim();
  const tone = draft.tone.trim();
  const skillId = runUsesSkill(steps, project.automationSettings) ? draft.skillId : undefined;
  const sourceVideo = sourceRequest(draft);
  return {
    ...(idea !== "" && { idea }),
    targetDurationSec: draft.targetDurationSec,
    ...(tone !== "" && { tone }),
    rankingMode: draft.rankingMode,
    ...(sourceVideo !== undefined && { sourceVideo }),
    ...(skillId !== undefined && { skillId }),
    language,
    replaceScenes: false,
  };
}

/**
 * "Duyệt và tạo video": the approved outline; null while it has no narration, and on a source video,
 * which is cut by the run itself instead of an outline (ADR 0020).
 */
export function approveRequest(draft: FullAiDraft, language: ContentLanguage): FullAiRequest | null {
  const outline = draft.outline && !draft.sourceVideo ? toFullAiOutline(draft.outline) : null;
  if (!outline) return null;
  const idea = draft.idea.trim();
  const tone = draft.tone.trim();
  return {
    ...(idea !== "" && { idea }),
    targetDurationSec: draft.targetDurationSec,
    ...(tone !== "" && { tone }),
    rankingMode: draft.rankingMode,
    ...(draft.skillId !== undefined && { skillId: draft.skillId }),
    language,
    outline,
    replaceScenes: false,
  };
}

export const STUDIO_STEPS: readonly { id: FullAiDraftStep; label: string }[] = [
  { id: "idea", label: "Ý tưởng" },
  { id: "questions", label: "Câu hỏi" },
  { id: "outline", label: "Khung kịch bản" },
];

export function studioStepNumber(step: FullAiDraftStep): number {
  return STUDIO_STEPS.findIndex((candidate) => candidate.id === step) + 1;
}

/** `30 giây · Tiếng Việt · hài hước` */
export function briefLine(draft: FullAiDraft, languageLabel: string): string {
  const tone = draft.tone.trim();
  return [`${String(draft.targetDurationSec)} giây`, languageLabel, ...(tone === "" ? [] : [tone])].join(
    " · ",
  );
}

/** The answer to each question in a few words, "AI tự chọn" when left empty. */
export function answerLines(draft: FullAiDraft): { question: string; answer: string }[] {
  const answered = new Map(briefAnswers(draft).map((item) => [item.question, item.answer]));
  return draft.questions.map((question) => ({
    question: question.text,
    answer: answered.get(question.text.slice(0, 300)) ?? "AI tự chọn",
  }));
}

/** Scene count and estimated length of the outline, and whether it runs over the target. */
export function outlineTotals(draft: FullAiDraft): { scenes: number; seconds: number; overTarget: boolean } {
  const outline = draft.outline ?? { title: "", scenes: [] };
  return {
    scenes: outline.scenes.length,
    seconds: outlineSeconds(outline),
    overTarget: isOutlineOverTarget(outline, draft.targetDurationSec),
  };
}

/** `Mở đầu`, `Ý 1`… `Kết` for the scenes of an outline. */
export function outlineSceneLabel(index: number, count: number): string {
  if (index === 0) return "Mở đầu";
  if (index === count - 1 && count > 2) return "Kết";
  return `Ý ${String(index)}`;
}

/** `Viết script → Chia cảnh → Tạo giọng` */
export function stepsLine(steps: readonly FullAiStep[]): string {
  return steps.map((step) => FULL_AI_STEP_LABELS[step]).join(" → ");
}

/** `Chia cảnh: ≈ 0,010 USD (tối đa 0,064 USD)` for each paid step. */
export function costLines(estimate: FullAiEstimate): string[] {
  return estimate.costs.map(
    (cost) =>
      `${FULL_AI_STEP_LABELS[cost.step]}: ≈ ${formatUsd(cost.expectedUsd)} (tối đa ${formatUsd(cost.maxUsd)})`,
  );
}

export function isRunning(job: RenderJob | null): boolean {
  return job !== null && (job.status === "QUEUED" || job.status === "PROCESSING");
}

/** `Bước 2/6: Chia cảnh · 40%` */
export function progressLine(job: RenderJob): string {
  if (job.status === "QUEUED") return "Đang chờ worker…";
  const steps = job.fullAi?.steps ?? [];
  const step = job.fullAi?.step;
  const percent = `${String(Math.round(job.progress * 100))}%`;
  if (step === undefined) return `Đang bắt đầu… · ${percent}`;
  return `Bước ${String(steps.indexOf(step) + 1)}/${String(steps.length)}: ${FULL_AI_STEP_LABELS[step]} · ${percent}`;
}

export interface ReviewStats {
  total: number;
  approved: number;
  withMedia: number;
  /** Scenes whose voice is missing or no longer matches the narration. */
  voiceToRedo: number;
}

export function reviewStats(project: Project): ReviewStats {
  let approved = 0;
  let withMedia = 0;
  let voiceToRedo = 0;
  for (const scene of project.scenes) {
    if (scene.status === "approved") approved += 1;
    if (scene.media) withMedia += 1;
    const voice = sceneVoiceStatus(project, scene);
    if (project.voice !== undefined && (voice === "missing" || voice === "outdated")) voiceToRedo += 1;
  }
  return { total: project.scenes.length, approved, withMedia, voiceToRedo };
}

/** The ranked candidates of a scene, without the one it already uses. */
export function alternativesFor(
  result: FullAiResult | null,
  project: Project,
  sceneId: string,
): MediaCandidate[] {
  const candidates = result?.scenes.find((scene) => scene.sceneId === sceneId)?.candidates ?? [];
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  const current = project.assets.find((asset) => asset.id === scene?.media?.assetId);
  // Imported stock files are named `<provider>-<ref>.<ext>`; library copies keep that name too. A project
  // upload is the asset itself.
  return candidates.filter(
    (candidate) =>
      current === undefined ||
      (candidate.provider === "project"
        ? candidate.ref !== current.id
        : !current.fileName.startsWith(`${candidate.provider}-${candidate.ref}.`)),
  );
}

export const MISSING_REASON_LABELS: Record<MissingSceneReason, string> = {
  no_candidates: "Không tìm thấy media nào",
  all_rejected: "AI thấy không media nào hợp",
  not_assigned: "Có media hợp nhưng tải về lỗi",
};

/** Anchor of a scene card on the review screen, for "Đến cảnh". */
export const reviewSceneAnchor = (sceneId: string) => `review-scene-${sceneId}`;

/**
 * Scenes the run left without media that still have none (ADR 0019), with their number. A scene the user
 * filled or deleted since drops out, so the list shrinks while they work through it.
 */
export function stillMissing(
  result: FullAiResult | null,
  project: Project,
): (MissingScene & { number: number })[] {
  return (result?.missingScenes ?? []).flatMap((missing) => {
    const index = project.scenes.findIndex((scene) => scene.id === missing.sceneId);
    const scene = project.scenes[index];
    return scene && scene.media === undefined ? [{ ...missing, number: index + 1 }] : [];
  });
}
