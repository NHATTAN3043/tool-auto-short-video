import {
  AI_RANK_MAX_CANDIDATES,
  AI_RANK_MAX_SCENES,
  assertFullAiRequest,
  countWords,
  DEFAULT_MAX_WORDS_PER_SCENE,
  DEFAULT_VOICE_TUNING,
  fullAiSteps,
  maxShotCount,
  projectLanguage,
  sourceCutShots,
  uploadSourceRef,
  type BudgetCheck,
  type FullAiRequest,
  type FullAiStep,
  type LibraryMedia,
  type MediaRankRequest,
  type Project,
  type SkillGuidance,
  type SourcePart,
  type VoiceSettings,
} from "@studio/domain";

import type { AiPort, AiResolver } from "../ports/ai";
import type { CostGuardPort } from "../ports/cost-guard";
import type { MediaLibraryRepository } from "../ports/media-library";
import type { ProjectRepository } from "../ports/project-repository";
import type { SkillCatalogPort } from "../ports/skill-catalog";
import type { TtsPort } from "../ports/tts";
import { resolveSkill } from "../skill/skills";

export interface FullAiDeps {
  repo: ProjectRepository;
  ai: AiPort;
  resolveAi?: AiResolver;
  /** Null without a TTS provider: the voice step is left out. */
  tts: TtsPort | null;
  /** From the environment; the estimate only needs the model. */
  voiceDefaults: { modelId?: string; voiceId?: string } | null;
  costGuard: CostGuardPort;
  /** Installed skills; without it a request naming a skill is refused. */
  skills?: SkillCatalogPort;
  /** Tells whether a source video is analyzed already (ADR 0020); without it, it is counted as not. */
  library?: MediaLibraryRepository;
}

export interface FullAiInput {
  projectId: string;
  request: FullAiRequest;
}

export interface FullAiStepEstimate {
  step: FullAiStep;
  expectedUsd: number;
  maxUsd: number;
}

export interface FullAiEstimate {
  /** Every step the run takes, in order (free ones too). */
  steps: FullAiStep[];
  /** Cost of the paid steps. */
  costs: FullAiStepEstimate[];
  /** Expected number of scenes the run makes. */
  sceneCount: number;
  expectedUsd: number;
  maxUsd: number;
  budget: BudgetCheck;
}

/** Speaking rate used for script length everywhere (see the script prompt). */
const WORDS_PER_SECOND = 2.6;
const SAMPLE_WORDS = "Đây là một câu mẫu để ước tính chi phí của video".split(" ");

/** Vietnamese-looking text of `words` words: later steps are estimated before their input exists. */
function sampleText(words: number): string {
  return Array.from({ length: words }, (_, i) => SAMPLE_WORDS[i % SAMPLE_WORDS.length]).join(" ");
}

/** The narration the later steps will work on: the project's script, or one of the target length. */
function plannedNarration(project: Project, request: FullAiRequest, steps: readonly FullAiStep[]) {
  const { outline } = request;
  if (outline) {
    // The approved outline is the real input: its scenes, and only the ones without a plan get one.
    const script = outline.scenes.map((scene) => scene.narration).join("\n\n");
    const sceneCount = outline.scenes.length;
    const words = Math.max(1, Math.ceil(countWords(script) / sceneCount));
    const unplanned = outline.scenes.filter((scene) => scene.visualPlan === undefined).length;
    return { script, sceneCount, sceneText: sampleText(words), visualScenes: unplanned };
  }
  const script = steps.includes("script")
    ? sampleText(Math.round(request.targetDurationSec * WORDS_PER_SECOND))
    : project.script;
  const sceneCount = Math.max(1, Math.ceil(countWords(script) / DEFAULT_MAX_WORDS_PER_SCENE));
  const words = Math.max(1, Math.ceil(countWords(script) / sceneCount));
  return { script, sceneCount, sceneText: sampleText(words), visualScenes: sceneCount };
}

/** Whether the hook or the ending was asked for. */
const sourcePart = (part: SourcePart | undefined) => part !== undefined && part.kind !== "none";

/** On a source video: the narration of the target length, shared by the main scene, the hook and the ending. */
function sourceNarration(request: FullAiRequest) {
  const wordsTotal = Math.round(request.targetDurationSec * WORDS_PER_SECOND);
  // One long main scene (ADR 0020), plus the hook and the ending.
  const sceneCount = 1 + [request.sourceVideo?.hook, request.sourceVideo?.outro].filter(sourcePart).length;
  const sceneText = sampleText(Math.max(1, Math.ceil(wordsTotal / sceneCount)));
  return { script: "", sceneCount, sceneText, visualScenes: 0 };
}

/**
 * What a Full AI run would cost, step by step, and whether its worst case fits the budgets. Free:
 * it counts tokens and characters, nothing is generated. Later steps are estimated from the target
 * length because their input does not exist yet.
 */
export function makeEstimateFullAi(deps: FullAiDeps) {
  async function aiStep(
    ai: AiPort,
    step: FullAiStep,
    tasks: Parameters<AiPort["estimate"]>[0][],
    guidance?: SkillGuidance,
  ) {
    const estimates = await Promise.all(tasks.map((task) => ai.estimate(task, guidance)));
    return {
      estimate: {
        step,
        expectedUsd: estimates.reduce((sum, e) => sum + e.expectedUsd, 0),
        maxUsd: estimates.reduce((sum, e) => sum + e.maxUsd, 0),
      },
      maxCallUsd: Math.max(0, ...estimates.map((e) => e.maxUsd)),
    };
  }

  function voiceFor(project: Project, tts: TtsPort): VoiceSettings {
    return (
      project.voice ?? {
        provider: tts.id,
        voiceId: deps.voiceDefaults?.voiceId ?? "default",
        modelId: deps.voiceDefaults?.modelId ?? tts.models[0]?.id ?? "default",
        ...DEFAULT_VOICE_TUNING,
      }
    );
  }

  /** The source video's library copy, when there is one, and the shots the cut will be shown. */
  async function sourceVideoState(project: Project, request: FullAiRequest) {
    const asset = project.assets.find((candidate) => candidate.id === request.sourceVideo?.assetId);
    if (!asset || asset.durationMs === undefined) return undefined;
    const item: LibraryMedia | null =
      asset.contentHash === undefined || !deps.library
        ? null
        : await deps.library.findBySourceRef(uploadSourceRef(asset.contentHash));
    const durationMs = item?.durationMs ?? asset.durationMs;
    const shots = item?.analysis
      ? sourceCutShots(item.analysis)
      : Array.from({ length: maxShotCount(durationMs) }, (_, i) => ({
          startMs: Math.floor((durationMs * i) / maxShotCount(durationMs)),
          endMs: Math.floor((durationMs * (i + 1)) / maxShotCount(durationMs)),
          description: sampleText(20),
          textOverlay: false,
        }));
    return { item, durationMs, shots };
  }

  return async (input: FullAiInput): Promise<FullAiEstimate> => {
    const project = await deps.repo.get(input.projectId);
    const ai = deps.resolveAi?.(project.ai) ?? deps.ai;
    const { request } = input;
    const source = await sourceVideoState(project, request);
    const steps = fullAiSteps(
      project.automationSettings,
      { tts: deps.tts !== null },
      request.outline,
      source && { analyzed: source.item?.analysis !== undefined },
    );
    assertFullAiRequest(project, request, steps);
    // The skill goes with the script and keyword steps, so it is counted there.
    const language = request.language ?? projectLanguage(project);
    const guidance = await resolveSkill(deps.skills ?? null, request.skillId, language);
    const planned = source ? sourceNarration(request) : plannedNarration(project, request, steps);
    const sampleScenes = Array.from({ length: planned.sceneCount }, (_, i) => ({
      id: `scene-${String(i + 1)}`,
      narration: planned.sceneText,
    }));

    const parts: { estimate: FullAiStepEstimate; maxCallUsd: number }[] = [];
    for (const step of steps) {
      if (step === "script") {
        parts.push(
          await aiStep(
            ai,
            step,
            [
              {
                type: "script",
                input: {
                  idea: request.idea ?? "",
                  targetDurationSec: request.targetDurationSec,
                  ...(request.tone !== undefined && { tone: request.tone }),
                  ...(request.skillId !== undefined && { skillId: request.skillId }),
                  language,
                },
              },
            ],
            guidance,
          ),
        );
      } else if (step === "scenes" && !request.outline && project.automationSettings.scenePlanning) {
        parts.push(
          await aiStep(
            ai,
            step,
            [
              {
                type: "scenes",
                input: {
                  script: planned.script,
                  maxWordsPerScene: DEFAULT_MAX_WORDS_PER_SCENE,
                  ...(request.skillId !== undefined && { skillId: request.skillId }),
                  language,
                },
              },
            ],
            guidance,
          ),
        );
      } else if (step === "visual") {
        parts.push(
          await aiStep(
            ai,
            step,
            [
              {
                type: "visual",
                input: {
                  script: planned.script,
                  scenes: sampleScenes.slice(0, Math.max(1, planned.visualScenes)),
                  ...(request.skillId !== undefined && { skillId: request.skillId }),
                },
              },
            ],
            guidance,
          ),
        );
      } else if (step === "rank") {
        const tasks = [];
        for (let i = 0; i < sampleScenes.length; i += AI_RANK_MAX_SCENES) {
          const input: MediaRankRequest = {
            mode: request.rankingMode,
            scenes: sampleScenes.slice(i, i + AI_RANK_MAX_SCENES).map((scene) => ({
              sceneId: scene.id,
              narration: scene.narration,
              candidates: Array.from({ length: AI_RANK_MAX_CANDIDATES }, (_, c) => ({
                key: `pexels:video:${String(c)}`,
                kind: "video" as const,
                width: 1080,
                height: 1920,
                description: planned.sceneText,
                thumbnail: { type: "remote" as const, url: "https://images.pexels.com/sample.jpg" },
              })),
            })),
          };
          tasks.push({ type: "rank_media" as const, input });
        }
        parts.push(await aiStep(ai, step, tasks));
      } else if (step === "analyze" && source) {
        // The shots are only known once ffmpeg cuts the video: the most it can have is reserved.
        const shots = ai.estimateShots(maxShotCount(source.durationMs));
        parts.push({
          estimate: { step, expectedUsd: shots.expectedUsd, maxUsd: shots.maxUsd },
          maxCallUsd: shots.maxUsd,
        });
      } else if (step === "cut" && source) {
        parts.push(
          await aiStep(
            ai,
            step,
            [
              {
                type: "source_cut",
                input: {
                  idea: request.idea ?? "",
                  targetDurationSec: request.targetDurationSec,
                  ...(request.tone !== undefined && { tone: request.tone }),
                  durationMs: source.durationMs,
                  shots: source.shots,
                  ...(request.sourceVideo?.script && { script: request.sourceVideo.script }),
                  // The clip lengths only change a few words of the prompt.
                  ...(sourcePart(request.sourceVideo?.hook) && { hook: { kind: "clip" as const } }),
                  ...(sourcePart(request.sourceVideo?.outro) && { outro: { kind: "clip" as const } }),
                  ...(request.skillId !== undefined && { skillId: request.skillId }),
                  language,
                },
              },
            ],
            guidance,
          ),
        );
      } else if (step === "voice" && deps.tts) {
        const voice = voiceFor(project, deps.tts);
        const perScene = deps.tts.estimate(planned.sceneText, voice).usd;
        const usd = perScene * planned.sceneCount;
        parts.push({ estimate: { step, expectedUsd: usd, maxUsd: usd }, maxCallUsd: perScene });
      }
    }

    const expectedUsd = parts.reduce((sum, part) => sum + part.estimate.expectedUsd, 0);
    const maxUsd = parts.reduce((sum, part) => sum + part.estimate.maxUsd, 0);
    const budget = await deps.costGuard.check({
      projectId: project.id,
      totalUsd: maxUsd,
      maxCallUsd: Math.max(0, ...parts.map((part) => part.maxCallUsd)),
    });
    return {
      steps,
      costs: parts.map((part) => part.estimate),
      sceneCount: planned.sceneCount,
      expectedUsd,
      maxUsd,
      budget,
    };
  };
}
