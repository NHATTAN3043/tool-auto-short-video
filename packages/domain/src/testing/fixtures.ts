import type { IdGenerator, IdPrefix } from "../ids";
import type { MediaAsset } from "../media/schema";
import { createProject } from "../project/create-project";
import type { Project } from "../project/schema";
import type { Scene } from "../scene/schema";

export const NOW = "2026-01-01T00:00:00.000Z";

export function sequentialIds(): IdGenerator {
  const counters = new Map<IdPrefix, number>();
  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}_${String(next)}`;
  };
}

export function scene(id: string, narration: string, extra: Partial<Scene> = {}): Scene {
  return { id, narration, status: "draft", ...extra };
}

export function asset(id: string, kind: MediaAsset["kind"], extra: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    kind,
    source: "upload",
    fileName: `${id}.bin`,
    path: `media/${id}.bin`,
    createdAt: NOW,
    ...extra,
  };
}

export function project(extra: Partial<Project> = {}): Project {
  return {
    ...createProject({ name: "Test", mode: "manual" }, { newId: () => "prj_1", now: NOW }),
    ...extra,
  };
}
