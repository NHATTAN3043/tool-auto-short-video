import { DomainError } from "../errors";
import type { Project } from "../project/schema";
import { MediaAssetSchema, type MediaAsset } from "./schema";

export function addAsset(project: Project, asset: MediaAsset): Project {
  const parsed = MediaAssetSchema.safeParse(asset);
  if (!parsed.success) {
    throw new DomainError("INVALID_MEDIA", parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  if (project.assets.some((existing) => existing.id === asset.id)) {
    throw new DomainError("INVALID_OPERATION", `Asset already exists: ${asset.id}`);
  }
  return { ...project, assets: [...project.assets, parsed.data] };
}

/** Ids referenced by the project (scene media, voices, sound effects, music) that have no asset. */
export function findMissingAssetIds(project: Project): string[] {
  const known = new Set(project.assets.map((asset) => asset.id));
  const referenced = [
    project.voiceAssetId,
    project.music?.assetId,
    ...project.scenes.flatMap((scene) => [
      scene.media?.assetId,
      scene.voiceAssetId,
      ...(scene.sfx ?? []).map((effect) => effect.assetId),
    ]),
  ];
  const missing = referenced.filter((id): id is string => id !== undefined && !known.has(id));
  return [...new Set(missing)];
}
