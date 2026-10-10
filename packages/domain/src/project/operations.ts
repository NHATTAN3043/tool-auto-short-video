import { DomainError } from "../errors";
import { ProjectStyleSchema, type CaptionStyle, type Music, type Project, type ProjectStyle } from "./schema";

export interface StylePatch {
  captions?: Partial<CaptionStyle>;
  transition?: ProjectStyle["transition"];
  transitionMs?: number;
}

function assertAudioAsset(project: Project, assetId: string, role: string): void {
  const asset = project.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new DomainError("ASSET_NOT_FOUND", `Asset not found: ${assetId}`);
  if (asset.kind !== "audio") throw new DomainError("INVALID_MEDIA", `${role} must be an audio asset`);
}

/** Sets the one voice file for the whole video, or removes it with null. */
export function setProjectVoice(project: Project, assetId: string | null): Project {
  if (assetId === null) {
    const next = { ...project };
    delete next.voiceAssetId;
    return next;
  }
  assertAudioAsset(project, assetId, "The project voice");
  return { ...project, voiceAssetId: assetId };
}

/** Sets the background music and its volume (0..1), or removes it with null. */
export function setMusic(project: Project, music: Music | null): Project {
  if (music === null) {
    const next = { ...project };
    delete next.music;
    return next;
  }
  assertAudioAsset(project, music.assetId, "Background music");
  if (!Number.isFinite(music.volume) || music.volume < 0 || music.volume > 1) {
    throw new DomainError("INVALID_INPUT", "Music volume must be between 0 and 1");
  }
  return { ...project, music: { assetId: music.assetId, volume: music.volume } };
}

/** Changes caption and transition settings; the result must still be a valid style. */
export function updateStyle(project: Project, patch: StylePatch): Project {
  const parsed = ProjectStyleSchema.safeParse({
    ...project.style,
    ...(patch.transition !== undefined && { transition: patch.transition }),
    ...(patch.transitionMs !== undefined && { transitionMs: patch.transitionMs }),
    captions: { ...project.style.captions, ...patch.captions },
  });
  if (!parsed.success) {
    throw new DomainError("INVALID_INPUT", parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return { ...project, style: parsed.data };
}
