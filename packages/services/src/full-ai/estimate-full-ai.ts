import {
  AI_RANK_MAX_CANDIDATES,
  AI_RANK_MAX_SCENES,
  assertFullAiRequest,
  countWords,
  DEFAULT_MAX_WORDS_PER_SCENE,
  DEFAULT_VOICE_TUNING,
  fullAiSteps,
  projectLanguage,
  type BudgetCheck,
  type FullAiRequest,
  type FullAiStep,
  type MediaRankRequest,
  type Project,
  type SkillGuidance,
  type VoiceSettings,
} from "@studio/domain";

import type { AiPort } from "../ports/ai";
import type { CostGuardPort } from "../ports/cost-guard";
import type { ProjectRepository } from "../ports/project-repository";
import type { SkillCatalogPort } from "../ports/skill-catalog";
import type { TtsPort } from "../ports/tts";
import { resolveSkill } from "../skill/skills";

export interface FullAiDeps {
  repo: ProjectRepository;
  ai: AiPort;
  /** Null without a TTS provider: the voice step is left out. */
  tts: TtsPort | null;
  /** From the environment; the estimate only needs the model. */
  voiceDefaults: { modelId?: string; voiceId?: string } | null;
  costGuard: CostGuardPort;
  /** Installed skills; without it a request naming a skill is refused. */
  skills?: SkillCatalogPort;
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

/**
 * What a Full AI run would cost, step by step, and whether its worst case fits the budgets. Free:
 * it counts tokens and characters, nothing is generated. Later steps are estimated from the target
 * length because their input does not exist yet.
 */
export function makeEstimateFullAi(deps: FullAiDeps) {
  async function aiStep(
    step: FullAiStep,
    tasks: Parameters<AiPort["estimate"]>[0][],
    guidance?: SkillGuidance,
  ) {
    const estimates = await Promise.all(tasks.map((task) => deps.ai.estimate(task, guidance)));
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

  return async (input: FullAiInput): Promise<FullAiEstimate> => {
    const project = await deps.repo.get(input.projectId);
    const steps = fullAiSteps(project.automationSettings, { tts: deps.tts !== null }, input.request.outline);
    assertFullAiRequest(project, input.request, steps);
    const { request } = input;
    // The skill goes with the script and keyword steps, so it is counted there.
    const language = request.language ?? projectLanguage(project);
    const guidance = await resolveSkill(deps.skills ?? null, request.skillId, language);
    const planned = plannedNarration(project, request, steps);
    const sampleScenes = Array.from({ length: planned.sceneCount }, (_, i) => ({
      id: `scene-${String(i + 1)}`,
      narration: planned.sceneText,
    }));

    const parts: { estimate: FullAiStepEstimate; maxCallUsd: number }[] = [];
    for (const step of steps) {
      if (step === "script") {
        parts.push(
          await aiStep(
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
        parts.push(await aiStep(step, tasks));
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
