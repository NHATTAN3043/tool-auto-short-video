import { DomainError } from "../errors";
import { newId, type DomainContext } from "../ids";
import type { MediaAsset } from "../media/schema";
import type { Project } from "../project/schema";
import { normalizeWhitespace } from "../text/words";
import {
  MAX_SFX_OFFSET_MS,
  SceneMediaSchema,
  SceneSfxSchema,
  type Scene,
  type SceneMedia,
  type SceneSfx,
  type SceneStatus,
  type VisualPlan,
} from "./schema";
import { splitNearMiddle } from "./split-text";

// Every operation returns a new project and never mutates its input, so UI undo is a matter of keeping
// the previous value. `updatedAt` is left to the service that persists the project.

export interface NewSceneInit {
  narration?: string;
  durationMs?: number;
  visualPlan?: VisualPlan;
}

/** `null` clears an optional field; `undefined` leaves it unchanged. Media changes go through assignMedia. */
export interface ScenePatch {
  narration?: string;
  durationMs?: number | null;
  voiceAssetId?: string | null;
  visualPlan?: VisualPlan | null;
  status?: SceneStatus;
}

export type SceneMediaInput = Pick<SceneMedia, "assetId"> & Partial<Omit<SceneMedia, "assetId">>;

function indexOfScene(project: Project, sceneId: string): number {
  const index = project.scenes.findIndex((scene) => scene.id === sceneId);
  if (index === -1) throw new DomainError("SCENE_NOT_FOUND", `Scene not found: ${sceneId}`);
  return index;
}

function sceneAt(project: Project, index: number): Scene {
  const scene = project.scenes[index];
  if (!scene) throw new DomainError("SCENE_NOT_FOUND", `No scene at index ${String(index)}`);
  return scene;
}

function findAsset(project: Project, assetId: string): MediaAsset {
  const asset = project.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new DomainError("ASSET_NOT_FOUND", `Asset not found: ${assetId}`);
  return asset;
}

function assertDuration(durationMs: number): void {
  if (!Number.isInteger(durationMs) || durationMs <= 0) {
    throw new DomainError("INVALID_INPUT", "durationMs must be a positive integer");
  }
}

function replaceScenes(project: Project, index: number, deleteCount: number, ...scenes: Scene[]): Project {
  const next = [...project.scenes];
  next.splice(index, deleteCount, ...scenes);
  return { ...project, scenes: next };
}

/** Inserts an empty draft scene after `afterSceneId`, or at the start when it is null. */
export function insertSceneAfter(
  project: Project,
  afterSceneId: string | null,
  init: NewSceneInit = {},
  ctx: DomainContext = {},
): Project {
  const index = afterSceneId === null ? 0 : indexOfScene(project, afterSceneId) + 1;
  if (init.durationMs !== undefined) assertDuration(init.durationMs);
  const scene: Scene = {
    id: (ctx.newId ?? newId)("scn"),
    narration: init.narration ?? "",
    status: "draft",
    ...(init.durationMs !== undefined && { durationMs: init.durationMs }),
    ...(init.visualPlan !== undefined && { visualPlan: init.visualPlan }),
  };
  return replaceScenes(project, index, 0, scene);
}

export function deleteScene(project: Project, sceneId: string): Project {
  return replaceScenes(project, indexOfScene(project, sceneId), 1);
}

/** Moves a scene to `toIndex`, clamped to the valid range. */
export function moveScene(project: Project, sceneId: string, toIndex: number): Project {
  const from = indexOfScene(project, sceneId);
  const scene = sceneAt(project, from);
  const to = Math.min(Math.max(Math.trunc(toIndex), 0), project.scenes.length - 1);
  if (to === from) return project;
  const without = replaceScenes(project, from, 1);
  return replaceScenes(without, to, 0, scene);
}

export function updateScene(project: Project, sceneId: string, patch: ScenePatch): Project {
  const index = indexOfScene(project, sceneId);
  const next: Scene = { ...sceneAt(project, index) };

  if (patch.narration !== undefined) next.narration = patch.narration;
  if (patch.status !== undefined) next.status = patch.status;

  if (patch.durationMs === null) delete next.durationMs;
  else if (patch.durationMs !== undefined) {
    assertDuration(patch.durationMs);
    next.durationMs = patch.durationMs;
  }

  if (patch.voiceAssetId === null) delete next.voiceAssetId;
  else if (patch.voiceAssetId !== undefined) {
    if (findAsset(project, patch.voiceAssetId).kind !== "audio") {
      throw new DomainError("INVALID_MEDIA", "A scene voice must be an audio asset");
    }
    next.voiceAssetId = patch.voiceAssetId;
  }

  if (patch.visualPlan === null) delete next.visualPlan;
  else if (patch.visualPlan !== undefined) next.visualPlan = patch.visualPlan;

  return replaceScenes(project, index, 1, next);
}

/**
 * Cuts a scene in two at the clause boundary nearest the middle. Media, sound effects and visual plan
 * stay on the first half; a manual duration is shared by text length. A per-scene voice no longer matches either half,
 * so it is dropped (the asset itself stays in the project).
 */
export function splitScene(project: Project, sceneId: string, ctx: DomainContext = {}): Project {
  const index = indexOfScene(project, sceneId);
  const scene: Scene = { ...sceneAt(project, index) };
  delete scene.voiceAssetId;
  const halves = splitNearMiddle(scene.narration);
  if (!halves) throw new DomainError("INVALID_OPERATION", "Scene narration is too short to split");
  const [head, tail] = halves;

  const first: Scene = { ...scene, narration: head };
  const second: Scene = { id: (ctx.newId ?? newId)("scn"), narration: tail, status: "draft" };
  if (scene.durationMs !== undefined) {
    const firstMs = Math.max(1, Math.round((scene.durationMs * head.length) / (head.length + tail.length)));
    first.durationMs = firstMs;
    second.durationMs = Math.max(1, scene.durationMs - firstMs);
  }
  return replaceScenes(project, index, 1, first, second);
}

/**
 * Joins a scene with the next one. The first scene keeps its id, status and media (falling back to the
 * next scene's media). Manual duration survives only when both had one; per-scene voices are dropped.
 * Sound effects of both are kept; the second scene's ones are shifted by the first scene's manual
 * duration when it has one (otherwise its length is not known here and offsets stay as they were).
 */
export function mergeWithNext(project: Project, sceneId: string): Project {
  const index = indexOfScene(project, sceneId);
  if (index === project.scenes.length - 1) {
    throw new DomainError("INVALID_OPERATION", "The last scene has no next scene to merge with");
  }
  const first = sceneAt(project, index);
  const second = sceneAt(project, index + 1);

  const merged: Scene = {
    ...first,
    narration: normalizeWhitespace(`${first.narration} ${second.narration}`),
  };
  delete merged.voiceAssetId;
  const media = first.media ?? second.media;
  if (media) merged.media = media;
  const visualPlan = first.visualPlan ?? second.visualPlan;
  if (visualPlan) merged.visualPlan = visualPlan;
  const shiftMs = first.durationMs ?? 0;
  const sfx = [
    ...(first.sfx ?? []),
    ...(second.sfx ?? []).map((effect) => ({
      ...effect,
      offsetMs: Math.min(effect.offsetMs + shiftMs, MAX_SFX_OFFSET_MS),
    })),
  ];
  if (sfx.length > 0) merged.sfx = sfx;
  if (first.durationMs !== undefined && second.durationMs !== undefined) {
    merged.durationMs = first.durationMs + second.durationMs;
  } else {
    delete merged.durationMs;
  }
  return replaceScenes(project, index, 2, merged);
}

/**
 * Attaches a video or image asset to a scene, filling defaults: start at 0, cover, centered crop,
 * clip audio muted, Ken Burns on for images. Images ignore source trimming.
 */
export function assignMedia(project: Project, sceneId: string, input: SceneMediaInput): Project {
  const index = indexOfScene(project, sceneId);
  const asset = findAsset(project, input.assetId);
  if (asset.kind === "audio") {
    throw new DomainError("INVALID_MEDIA", "Audio assets cannot be used as scene visuals");
  }

  const isVideo = asset.kind === "video";
  const sourceStartMs = isVideo ? (input.sourceStartMs ?? 0) : 0;
  let sourceEndMs = isVideo ? input.sourceEndMs : undefined;
  if (isVideo && asset.durationMs !== undefined) {
    if (sourceStartMs >= asset.durationMs) {
      throw new DomainError("INVALID_MEDIA", "sourceStartMs is beyond the end of the video");
    }
    // Probed durations are rounded, so an end slightly past the file is clamped rather than rejected.
    if (sourceEndMs !== undefined) sourceEndMs = Math.min(sourceEndMs, asset.durationMs);
  }

  const parsed = SceneMediaSchema.safeParse({
    assetId: asset.id,
    sourceStartMs,
    ...(sourceEndMs !== undefined && { sourceEndMs }),
    fit: input.fit ?? "cover",
    focusX: input.focusX ?? 0.5,
    volume: isVideo ? (input.volume ?? 0) : 0,
    kenBurns: input.kenBurns ?? !isVideo,
  });
  if (!parsed.success) {
    throw new DomainError("INVALID_MEDIA", parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return replaceScenes(project, index, 1, { ...sceneAt(project, index), media: parsed.data });
}

export function clearMedia(project: Project, sceneId: string): Project {
  const index = indexOfScene(project, sceneId);
  const scene: Scene = { ...sceneAt(project, index) };
  delete scene.media;
  return replaceScenes(project, index, 1, scene);
}

/** `sourceEndMs: null` removes the end (play until the scene ends); other fields replace the current value. */
export type SceneMediaPatch = Partial<Omit<SceneMedia, "assetId" | "sourceEndMs">> & {
  sourceEndMs?: number | null;
};

/** Changes trim, framing or volume of the media already on a scene, with the same rules as assignMedia. */
export function updateSceneMedia(project: Project, sceneId: string, patch: SceneMediaPatch): Project {
  const current = sceneAt(project, indexOfScene(project, sceneId)).media;
  if (!current) throw new DomainError("INVALID_OPERATION", `Scene has no media: ${sceneId}`);
  const { sourceEndMs, ...rest } = patch;
  const input: SceneMediaInput = { ...current, ...rest };
  if (sourceEndMs === null) delete input.sourceEndMs;
  else if (sourceEndMs !== undefined) input.sourceEndMs = sourceEndMs;
  return assignMedia(project, sceneId, input);
}

export type SceneSfxInput = Pick<SceneSfx, "assetId"> & Partial<Pick<SceneSfx, "offsetMs" | "volume">>;
export type SceneSfxPatch = Partial<Pick<SceneSfx, "offsetMs" | "volume">>;

export const DEFAULT_SFX_VOLUME = 0.8;

function parseSfx(value: SceneSfx): SceneSfx {
  const parsed = SceneSfxSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError("INVALID_INPUT", parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}

function withSfx(project: Project, index: number, sfx: SceneSfx[]): Project {
  const scene: Scene = { ...sceneAt(project, index) };
  if (sfx.length > 0) scene.sfx = sfx;
  else delete scene.sfx;
  return replaceScenes(project, index, 1, scene);
}

function sfxOf(
  project: Project,
  index: number,
  sfxId: string,
): { list: SceneSfx[]; at: number; effect: SceneSfx } {
  const list = [...(sceneAt(project, index).sfx ?? [])];
  const at = list.findIndex((effect) => effect.id === sfxId);
  const effect = list[at];
  if (!effect) throw new DomainError("SFX_NOT_FOUND", `Sound effect not found: ${sfxId}`);
  return { list, at, effect };
}

/** Adds a sound effect (an audio asset already in the project) to a scene; default: scene start, 80%. */
export function addSceneSfx(
  project: Project,
  sceneId: string,
  input: SceneSfxInput,
  ctx: DomainContext = {},
): Project {
  const index = indexOfScene(project, sceneId);
  if (findAsset(project, input.assetId).kind !== "audio") {
    throw new DomainError("INVALID_MEDIA", "A sound effect must be an audio asset");
  }
  const effect = parseSfx({
    id: (ctx.newId ?? newId)("sfx"),
    assetId: input.assetId,
    offsetMs: input.offsetMs ?? 0,
    volume: input.volume ?? DEFAULT_SFX_VOLUME,
  });
  return withSfx(project, index, [...(sceneAt(project, index).sfx ?? []), effect]);
}

export function updateSceneSfx(
  project: Project,
  sceneId: string,
  sfxId: string,
  patch: SceneSfxPatch,
): Project {
  const index = indexOfScene(project, sceneId);
  const { list, at, effect } = sfxOf(project, index, sfxId);
  list[at] = parseSfx({ ...effect, ...patch });
  return withSfx(project, index, list);
}

export function removeSceneSfx(project: Project, sceneId: string, sfxId: string): Project {
  const index = indexOfScene(project, sceneId);
  const { list, at } = sfxOf(project, index, sfxId);
  list.splice(at, 1);
  return withSfx(project, index, list);
}
