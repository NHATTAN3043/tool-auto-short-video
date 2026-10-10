import {
  DomainError,
  narrationForSpeech,
  scenesNeedingVoice,
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
    const sceneIds = scenesNeedingVoice(project, input.sceneIds);
    const texts = project.scenes
      .filter((scene) => sceneIds.includes(scene.id))
      .map((scene) => narrationForSpeech(scene.narration));
    const total = deps.tts.estimate(texts.join(""), voice);
    const maxCallUsd = Math.max(0, ...texts.map((text) => deps.tts.estimate(text, voice).usd));
    const budget = await deps.costGuard.check({ projectId: project.id, totalUsd: total.usd, maxCallUsd });
    return { sceneIds, ...total, budget };
  };
}
