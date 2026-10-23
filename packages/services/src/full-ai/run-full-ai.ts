import {
  AI_RANK_MAX_CANDIDATES,
  AI_RANK_MAX_OWN,
  AI_RANK_MAX_SCENES,
  applyFullAiOutline,
  applyScenePlan,
  applyVisualPlans,
  assignMedia,
  candidateKey,
  capOwnCandidates,
  selectionOrder,
  DEFAULT_MAX_WORDS_PER_SCENE,
  DomainError,
  FULL_AI_MAX_WARNINGS,
  FULL_AI_STEP_LABELS,
  FullAiResultSchema,
  initialVoiceSettings,
  isDomainError,
  isOwnCandidate,
  narrationForSpeech,
  normalizeMediaRanking,
  normalizeScenePlan,
  normalizeScriptSuggestion,
  normalizeVisualPlans,
  orderByRanking,
  projectLanguage,
  scriptToScenes,
  setAiSkill,
  setMediaRankingMode,
  setProjectLanguage,
  setVoiceSettings,
  setVoiceTrack,
  toRankCandidate,
  type ContentLanguage,
  type FullAiResult,
  type FullAiStep,
  type MediaCandidate,
  type MediaRankRequest,
  type MediaSearchQuery,
  type Project,
  type RenderJob,
  type SkillGuidance,
} from "@studio/domain";

import type { MediaSearchResult } from "../media-search/search-media";
import type { ImportCandidateInput, ImportCandidateResult } from "../media-search/import-candidate";
import { fullAiDraftKey } from "./draft";
import { AiCallError, type AiPort } from "../ports/ai";
import type { Clock } from "../ports/clock";
import type { PaidPortFactory } from "../ports/cost-guard";
import type { ProjectRepository } from "../ports/project-repository";
import type { SkillCatalogPort } from "../ports/skill-catalog";
import type { StoragePort } from "../ports/storage";
import type { TtsPort } from "../ports/tts";
import type { ResolveRankImages } from "../ai/rank-images";
import type { GenerateSceneVoicesInput, GenerateSceneVoicesResult } from "../voice/generate-scene-voices";

export interface RunFullAiDeps {
  repo: ProjectRepository;
  storage: StoragePort;
  clock: Clock;
  /** Bound to the job, so CostGuard checks and logs every call. */
  ai: PaidPortFactory<AiPort>;
  searchMedia: (input: { projectId: string; query: MediaSearchQuery }) => Promise<MediaSearchResult>;
  importCandidate: (input: ImportCandidateInput) => Promise<ImportCandidateResult>;
  rankImages: ResolveRankImages;
  /** Installed skills (ADR 0012); without it a requested skill is skipped with a warning. */
  skills?: SkillCatalogPort;
  /** Null without a TTS provider; the voice step then only warns. */
  voices: {
    tts: TtsPort;
    generate: (input: GenerateSceneVoicesInput) => Promise<GenerateSceneVoicesResult>;
    /** From the environment; the first voice and model of the account fill what is missing. */
    defaults: { modelId?: string; voiceId?: string } | null;
  } | null;
}

export interface RunFullAiInput {
  job: RenderJob;
  /** Called when a step starts, and with the overall progress 0..1. */
  onStep: (step: FullAiStep) => void;
  onProgress: (progress: number) => void;
}

export type RunFullAiResult =
  | { ok: true; outputPath: string; costUsd: number; warnings: string[] }
  /** The project keeps what the finished steps made. */
  | { ok: false; message: string; costUsd: number };

/** Search queries tried per scene, in order, until enough candidates are found to rank. */
const QUERIES_PER_SCENE = 2;
/** Candidates tried per scene when a download fails. */
const IMPORT_ATTEMPTS = 3;

async function* bytes(data: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield data;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isBudget = (error: unknown) => isDomainError(error) && error.code === "BUDGET_EXCEEDED";

/**
 * Runs the steps of a Full AI job on the project (ADR 0010). Unlike single AI tasks the worker applies
 * each result itself, and the user reviews afterwards. Script and scene steps are required; search,
 * ranking, selection and voices are best effort: what fails there becomes a warning. A blocked budget
 * stops the run at once. The ranked candidates are stored for "Đổi media" on the review screen.
 */
export function makeRunFullAi(deps: RunFullAiDeps) {
  return async (input: RunFullAiInput): Promise<RunFullAiResult> => {
    const { job } = input;
    const info = job.fullAi;
    if (!info) return { ok: false, message: "Job Full AI thiếu nội dung yêu cầu", costUsd: 0 };
    const { request, steps } = info;
    const projectId = job.projectId;
    const ai = deps.ai({ projectId, jobId: job.id });
    const warnings: string[] = [];
    const warn = (message: string) => {
      if (warnings.length < FULL_AI_MAX_WARNINGS && !warnings.includes(message)) warnings.push(message);
    };
    let costUsd = 0;
    let current: FullAiStep = steps[0] ?? "scenes";
    /**
     * Ranked candidates per scene, filled by the media and rank steps. `rejected` are the keys the AI said
     * do not fit; they stay in the list for "Đổi media" but are never picked automatically.
     */
    const found = new Map<string, { query: string; candidates: MediaCandidate[]; rejected: Set<string> }>();

    async function paid<T extends { usage: { usd: number } }>(call: () => Promise<T>): Promise<T> {
      try {
        const result = await call();
        costUsd += result.usage.usd;
        return result;
      } catch (error) {
        if (error instanceof AiCallError) costUsd += error.usage?.usd ?? 0;
        throw error;
      }
    }

    const update = (change: (project: Project) => Project) =>
      deps.repo.update(projectId, (project) => ({ ...change(project), updatedAt: deps.clock.now() }));

    const sceneLabel = (project: Project, sceneId: string) =>
      `Cảnh ${String(project.scenes.findIndex((scene) => scene.id === sceneId) + 1)}`;

    /** The narration language of this run, set before the first step (ADR 0013). */
    let language: ContentLanguage = "vi";

    /** Read once per run; a skill removed since the request is skipped, the run goes on without it. */
    let guidance: SkillGuidance | undefined;
    const withSkill = <T extends object>(task: T): T =>
      guidance === undefined ? task : { ...task, skillId: guidance.id };

    async function loadSkill(skillId: string | undefined): Promise<void> {
      if (skillId === undefined) return;
      try {
        guidance = (await deps.skills?.get(skillId, language)) ?? undefined;
      } catch {
        guidance = undefined;
      }
      if (guidance === undefined) warn(`Không đọc được skill "${skillId}", đã chạy không dùng skill`);
    }

    async function writeScript(): Promise<void> {
      const { data } = await paid(() =>
        ai.generateScript(
          withSkill({
            idea: request.idea ?? "",
            targetDurationSec: request.targetDurationSec,
            ...(request.tone !== undefined && { tone: request.tone }),
            language,
          }),
          guidance,
        ),
      );
      const { script } = normalizeScriptSuggestion(data, language);
      await update((project) => ({ ...project, script }));
    }

    async function makeScenes(): Promise<void> {
      const project = await deps.repo.get(projectId);
      const { outline } = request;
      if (outline) {
        // Approved word for word by the user (ADR 0015): no AI call.
        await update((stored) => applyFullAiOutline(stored, outline));
      } else if (project.automationSettings.scenePlanning) {
        const { data } = await paid(() =>
          ai.planScenes(
            withSkill({ script: project.script, maxWordsPerScene: DEFAULT_MAX_WORDS_PER_SCENE, language }),
            guidance,
          ),
        );
        const plan = normalizeScenePlan(data);
        await update((stored) => applyScenePlan(stored, plan));
      } else {
        await update((stored) => ({ ...stored, scenes: scriptToScenes(stored.script) }));
      }
      if ((await deps.repo.get(projectId)).scenes.length === 0) {
        throw new DomainError("INVALID_OPERATION", "Script không tạo ra cảnh nào");
      }
    }

    async function suggestVisuals(): Promise<void> {
      const project = await deps.repo.get(projectId);
      // After an outline only the added or edited scenes lack a plan; the others keep the approved one.
      const scenes = project.scenes
        .filter((scene) => scene.narration.trim() !== "")
        .filter((scene) => request.outline === undefined || scene.visualPlan === undefined)
        .map((scene) => ({ id: scene.id, narration: scene.narration }));
      if (scenes.length === 0) return;
      const { data } = await paid(() =>
        ai.generateVisualPlans(withSkill({ script: project.script, scenes }), guidance),
      );
      const plans = normalizeVisualPlans(
        data,
        scenes.map((scene) => scene.id),
      );
      await update((stored) => applyVisualPlans(stored, plans));
    }

    async function searchScenes(): Promise<void> {
      const project = await deps.repo.get(projectId);
      for (const [index, scene] of project.scenes.entries()) {
        const queries = scene.visualPlan?.searchQueries.slice(0, QUERIES_PER_SCENE) ?? [];
        const kind = scene.visualPlan?.preferredMedia ?? "video";
        // A query that finds only a few files leaves room: the next query adds to them.
        let merged: MediaCandidate[] = [];
        let firstQuery: string | undefined;
        for (const query of queries) {
          const result = await deps.searchMedia({
            projectId,
            query: { query, kind, lang: "en", sources: ["project", "library", "pexels", "pixabay"] },
          });
          for (const failure of result.errors)
            warn(`${failure.provider} lỗi khi tìm media: ${failure.message}`);
          const seen = new Set(merged.map(candidateKey));
          const fresh = result.candidates.filter((candidate) => !seen.has(candidateKey(candidate)));
          if (fresh.length > 0) firstQuery ??= query;
          merged = [...merged, ...fresh];
          if (merged.length >= AI_RANK_MAX_CANDIDATES) break;
        }
        if (firstQuery !== undefined) {
          // Own files first, but at most AI_RANK_MAX_OWN of them: stock always gets places too.
          const ownFirst = [
            ...merged.filter(isOwnCandidate),
            ...merged.filter((candidate) => !isOwnCandidate(candidate)),
          ];
          const candidates = capOwnCandidates(ownFirst, AI_RANK_MAX_CANDIDATES, AI_RANK_MAX_OWN);
          found.set(scene.id, { query: firstQuery, candidates, rejected: new Set() });
        }
        if (!found.has(scene.id)) {
          warn(
            queries.length === 0
              ? `Cảnh ${String(index + 1)}: chưa có từ khoá tìm hình`
              : `Cảnh ${String(index + 1)}: không tìm thấy media phù hợp`,
          );
        }
        input.onProgress(stepProgress((index + 1) / project.scenes.length));
      }
    }

    async function rankScenes(): Promise<void> {
      const project = await deps.repo.get(projectId);
      const scenes = project.scenes.filter((scene) => found.has(scene.id));
      for (let i = 0; i < scenes.length; i += AI_RANK_MAX_SCENES) {
        const rankRequest: MediaRankRequest = {
          mode: request.rankingMode,
          scenes: scenes.slice(i, i + AI_RANK_MAX_SCENES).map((scene) => ({
            sceneId: scene.id,
            narration: scene.narration.slice(0, 5000),
            ...(scene.visualPlan?.intent && { intent: scene.visualPlan.intent.slice(0, 500) }),
            candidates: (found.get(scene.id)?.candidates ?? []).map(toRankCandidate),
          })),
        };
        try {
          const images = await deps.rankImages(rankRequest);
          const { data } = await paid(() => ai.rankMedia(rankRequest, images));
          for (const ranked of normalizeMediaRanking(data, rankRequest).scenes) {
            const entry = found.get(ranked.sceneId);
            if (!entry) continue;
            entry.candidates = orderByRanking(entry.candidates, ranked.keys);
            entry.rejected = new Set(ranked.rejected);
          }
        } catch (error) {
          if (isBudget(error)) throw error;
          // Ranking only improves the order; the search order still works.
          warn(`Không xếp hạng được media: ${errorMessage(error)}`);
        }
      }
    }

    async function selectMedia(): Promise<void> {
      const project = await deps.repo.get(projectId);
      const scenes = project.scenes.filter((scene) => found.has(scene.id));
      // Shots of analyzed clips already given to a scene in this run (ADR 0019).
      const usedShots = new Set<string>();
      for (const [index, scene] of scenes.entries()) {
        const entry = found.get(scene.id);
        if (!entry) continue;
        const usable = selectionOrder(
          entry.candidates.filter((candidate) => !entry.rejected.has(candidateKey(candidate))),
          usedShots,
        );
        if (usable.length === 0) {
          // The AI found nothing fitting: an empty scene is better than a wrong picture.
          warn(`${sceneLabel(project, scene.id)}: AI thấy không media nào phù hợp, hãy chọn tay`);
          input.onProgress(stepProgress((index + 1) / scenes.length));
          continue;
        }
        let picked: { result: ImportCandidateResult; candidate: MediaCandidate } | null = null;
        let lastError = "";
        for (const candidate of usable.slice(0, IMPORT_ATTEMPTS)) {
          try {
            const result = await deps.importCandidate({
              projectId,
              candidate: {
                provider: candidate.provider,
                ref: candidate.ref,
                kind: candidate.kind,
                ...(candidate.segment && { segmentIndex: candidate.segment.index }),
              },
              query: entry.query,
            });
            picked = { result, candidate };
            break;
          } catch (error) {
            lastError = errorMessage(error);
          }
        }
        if (picked) {
          const { asset, startMs } = picked.result;
          const media = { assetId: asset.id, ...(startMs !== undefined && { sourceStartMs: startMs }) };
          await update((stored) =>
            stored.scenes.some((candidate) => candidate.id === scene.id)
              ? assignMedia(stored, scene.id, media)
              : stored,
          );
          if (picked.candidate.segment) usedShots.add(candidateKey(picked.candidate));
          if (picked.candidate.textOverlay === true) {
            warn(`${sceneLabel(project, scene.id)}: đoạn được chọn có chữ/logo in sẵn, hãy kiểm tra lại`);
          }
        } else {
          warn(`${sceneLabel(project, scene.id)}: không tải được media (${lastError})`);
        }
        input.onProgress(stepProgress((index + 1) / scenes.length));
      }
    }

    async function makeVoices(): Promise<void> {
      if (!deps.voices) {
        warn("Chưa cấu hình dịch vụ tạo giọng (ELEVENLABS_API_KEY) cho worker");
        return;
      }
      const { tts, generate, defaults } = deps.voices;
      let project = await deps.repo.get(projectId);
      if (project.voice === undefined) {
        // Q5 of M11b: the configured voice, else the first voice of the account.
        const voices = defaults?.voiceId === undefined ? await tts.listVoices() : [];
        const voice = initialVoiceSettings({ provider: tts.id, defaults, voices, models: tts.models });
        if (!voice) {
          warn("Tài khoản ElevenLabs chưa có giọng nào để tạo giọng đọc");
          return;
        }
        project = await update((stored) => setVoiceSettings(stored, voice));
      }
      if (project.voiceAssetId !== undefined)
        project = await update((stored) => setVoiceTrack(stored, "scenes"));
      const voice = project.voice;
      const result = await generate({
        projectId,
        jobId: job.id,
        sceneIds: project.scenes.map((scene) => scene.id),
        onProgress: (fraction) => {
          input.onProgress(stepProgress(fraction));
        },
      });
      if (voice) {
        for (const scene of project.scenes) {
          if (result.generated.includes(scene.id)) {
            costUsd += tts.estimate(narrationForSpeech(scene.narration), voice).usd;
          }
        }
      }
      for (const failure of result.failed) {
        warn(`${sceneLabel(project, failure.sceneId)}: không tạo được giọng (${failure.message})`);
      }
    }

    /** Voices are best effort: a provider error is a warning, the scenes and media stay. */
    async function makeVoicesSafely(): Promise<void> {
      try {
        await makeVoices();
      } catch (error) {
        if (isBudget(error)) throw error;
        warn(`Không tạo được giọng: ${errorMessage(error)}`);
      }
    }

    const run: Record<FullAiStep, () => Promise<void>> = {
      script: writeScript,
      scenes: makeScenes,
      visual: suggestVisuals,
      media: searchScenes,
      rank: rankScenes,
      select: selectMedia,
      voice: makeVoicesSafely,
    };

    let stepIndex = 0;
    function stepProgress(fraction: number): number {
      return (stepIndex + Math.min(1, Math.max(0, fraction))) / steps.length;
    }

    try {
      // The request's choice becomes the project's, so the voice step and later edits use it too.
      // The ranking mode and the skill are remembered too, preselected next time and for rewrites.
      const chosen = request.language;
      const project = await update((stored) => {
        const remembered = setAiSkill(setMediaRankingMode(stored, request.rankingMode), request.skillId);
        return chosen === undefined ? remembered : setProjectLanguage(remembered, chosen);
      });
      language = projectLanguage(project);
      await loadSkill(request.skillId);
      for (const [index, step] of steps.entries()) {
        stepIndex = index;
        current = step;
        input.onStep(step);
        input.onProgress(stepProgress(0));
        await run[step]();
      }
    } catch (error) {
      const reason =
        error instanceof AiCallError && error.code === "AI_REFUSED"
          ? "AI từ chối yêu cầu này. Hãy diễn đạt lại ý tưởng."
          : errorMessage(error);
      return { ok: false, message: `Dừng ở bước "${FULL_AI_STEP_LABELS[current]}": ${reason}`, costUsd };
    }

    const project = await deps.repo.get(projectId);
    const result: FullAiResult = FullAiResultSchema.parse({
      scenes: project.scenes.flatMap((scene) => {
        const entry = found.get(scene.id);
        return entry ? [{ sceneId: scene.id, candidates: entry.candidates }] : [];
      }),
      warnings,
    });
    const outputPath = `full-ai/${job.id}.json`;
    await deps.storage.write(
      `projects/${projectId}/${outputPath}`,
      bytes(new TextEncoder().encode(JSON.stringify(result))),
    );
    // The draft became this run; a failed run keeps it so the user can try again.
    await deps.storage.remove(fullAiDraftKey(projectId));
    return { ok: true, outputPath, costUsd, warnings };
  };
}
