import {
  DEFAULT_VOICE_TUNING,
  formatUsd,
  initialVoiceSettings as initialDomainVoiceSettings,
  scenesNeedingVoice,
  sceneVoiceStatus,
  type Project,
  type RenderJob,
  type SceneVoiceStatus,
  type VoiceSettings,
} from "@studio/domain";

import type { VoiceCatalog, VoiceEstimate } from "./api";

// Pure rules of the voice panel: labels, defaults, what is still running, how to show a cost.

export const VOICE_POLL_INTERVAL_MS = 1500;

export const VOICE_STATUS_LABELS: Record<
  SceneVoiceStatus,
  { title: string; description: string; tone: "default" | "secondary" | "outline" | "destructive" }
> = {
  empty: { title: "Chưa có lời", description: "Cảnh không có lời để đọc.", tone: "outline" },
  missing: { title: "Chưa có giọng", description: "Cảnh chưa có giọng AI.", tone: "outline" },
  current: {
    title: "Giọng khớp lời",
    description: "Giọng đã tạo đúng với lời và cài đặt hiện tại.",
    tone: "secondary",
  },
  outdated: {
    title: "Lời đã đổi",
    description: "Lời hoặc cài đặt giọng đã đổi sau khi tạo giọng; cần tạo lại.",
    tone: "destructive",
  },
  uploaded: { title: "Voice tải lên", description: "Cảnh dùng file voice bạn tải lên.", tone: "secondary" },
};

export { DEFAULT_VOICE_TUNING };

export const VOICE_LIMITS = {
  stability: { min: 0, max: 1, step: 0.05 },
  similarityBoost: { min: 0, max: 1, step: 0.05 },
  speed: { min: 0.7, max: 1.2, step: 0.05 },
} as const;

/** Settings a project starts from: the configured default voice, else the first one of the account. */
export function initialVoiceSettings(catalog: VoiceCatalog): VoiceSettings | null {
  return initialDomainVoiceSettings(catalog);
}

/** `An · male, young` */
export function voiceOptionLabel(voice: VoiceCatalog["voices"][number]): string {
  const labels = ["gender", "age", "accent"]
    .map((key) => voice.labels[key])
    .filter((value): value is string => value !== undefined && value !== "");
  return labels.length === 0 ? voice.name : `${voice.name} · ${labels.join(", ")}`;
}

export { formatUsd };

/** `2 cảnh · 120 ký tự · 60 credit · ≈ 0,036 USD` */
export function estimateSummary(
  estimate: Pick<VoiceEstimate, "sceneIds" | "characters" | "credits" | "usd">,
): string {
  const numbers = new Intl.NumberFormat("vi-VN");
  return [
    `${String(estimate.sceneIds.length)} cảnh`,
    `${numbers.format(estimate.characters)} ký tự`,
    `${numbers.format(estimate.credits)} credit`,
    `≈ ${formatUsd(estimate.usd)}`,
  ].join(" · ");
}

export function isVoiceJob(job: RenderJob): boolean {
  return job.kind === "tts";
}

export function isRunning(job: RenderJob | null): boolean {
  return job !== null && (job.status === "QUEUED" || job.status === "PROCESSING");
}

/** True while a running voice job will (re)generate this scene. */
export function jobCoversScene(job: RenderJob | null, sceneId: string): boolean {
  return job !== null && isRunning(job) && job.sceneIds?.includes(sceneId) === true;
}

export function canGenerate(status: SceneVoiceStatus): boolean {
  return status === "missing" || status === "outdated";
}

export interface VoiceOverview {
  /** Scenes the "generate changed voices" button would produce. */
  needed: string[];
  missing: number;
  outdated: number;
}

export function voiceOverview(project: Project): VoiceOverview {
  const needed = scenesNeedingVoice(project);
  const statuses = project.scenes.map((scene) => sceneVoiceStatus(project, scene));
  return {
    needed,
    missing: statuses.filter((status) => status === "missing").length,
    outdated: statuses.filter((status) => status === "outdated").length,
  };
}

/** Scene numbers (1-based) for messages: `2, 4`. */
export function sceneNumbers(project: Project, sceneIds: readonly string[]): string {
  const wanted = new Set(sceneIds);
  return project.scenes
    .flatMap((scene, index) => (wanted.has(scene.id) ? [String(index + 1)] : []))
    .join(", ");
}
