import {
  DomainError,
  narrationForSpeech,
  scenesNeedingVoice,
  sceneVoiceStatus,
  type BudgetCheck,
  type Project,
} from "@studio/domain";

import type { CostGuardPort } from "../ports/cost-guard";
import type { ProjectRepository } from "../ports/project-repository";
import type { TtsEstimate, TtsPort } from "../ports/tts";

export interface SceneVoicesEstimate extends TtsEstimate {
  /** Scenes that would be generated: missing or outdated voices among the requested ones. */
  sceneIds: string[];
  /** One call per scene; the most expensive scene is checked against the per-call budget. */
  budget: BudgetCheck;
}

export interface SceneVoicesInput {
  projectId: string;
  /** Default: every scene. */
  sceneIds?: readonly string[];
  /**
   * Make a new take of every requested scene that has narration, even when its voice still matches or
   * is an uploaded file. Default: only missing or outdated voices.
   */
  regenerate?: boolean;
}

/** Scenes a voice run covers, in scene order: changed voices, or with `regenerate` every scene with words. */
export function scenesToVoice(
  project: Project,
  sceneIds: readonly string[] | undefined,
  regenerate: boolean,
): string[] {
  if (!regenerate) return scenesNeedingVoice(project, sceneIds);
  const wanted = sceneIds === undefined ? null : new Set(sceneIds);
  return project.scenes
    .filter((scene) => wanted === null || wanted.has(scene.id))
    .filter((scene) => sceneVoiceStatus(project, scene) !== "empty")
    .map((scene) => scene.id);
}

export function requireVoiceSettings(project: Project): NonNullable<Project["voice"]> {
  if (project.voice === undefined) {
    throw new DomainError("INVALID_OPERATION", "Choose a voice before generating scene voices");
  }
  return project.voice;
}

/** What generating the changed scene voices would cost, shown before the user confirms. No paid call. */
export function makeEstimateSceneVoices(deps: {
  repo: ProjectRepository;
  tts: TtsPort;
  costGuard: CostGuardPort;
}) {
  return async (input: SceneVoicesInput): Promise<SceneVoicesEstimate> => {
    const project = await deps.repo.get(input.projectId);
    const voice = requireVoiceSettings(project);
    const sceneIds = scenesToVoice(project, input.sceneIds, input.regenerate === true);
    const texts = project.scenes
      .filter((scene) => sceneIds.includes(scene.id))
      .map((scene) => narrationForSpeech(scene.narration));
    const total = deps.tts.estimate(texts.join(""), voice);
    const maxCallUsd = Math.max(0, ...texts.map((text) => deps.tts.estimate(text, voice).usd));
    const budget = await deps.costGuard.check({ projectId: project.id, totalUsd: total.usd, maxCallUsd });
    return { sceneIds, ...total, budget };
  };
}
