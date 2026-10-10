import { DomainError, findMissingAssetIds, ProjectSchema, type Project } from "@studio/domain";

import type { Clock } from "../ports/clock";
import type { ProjectRepository } from "../ports/project-repository";

/**
 * Saves an edited project coming from the client. Assets are owned by the server (only importAsset
 * adds them), so the stored list wins: an autosave holding a stale copy can never drop an asset that
 * was uploaded in the meantime.
 */
export function makeSaveProject(deps: { repo: ProjectRepository; clock: Clock }) {
  return async (raw: unknown): Promise<Project> => {
    const parsed = ProjectSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DomainError("INVALID_PROJECT", parsed.error.issues.map((issue) => issue.message).join("; "));
    }
    const incoming = parsed.data;
    return await deps.repo.update(incoming.id, (stored) => {
      const next: Project = {
        ...incoming,
        assets: stored.assets,
        createdAt: stored.createdAt,
        updatedAt: deps.clock.now(),
      };
      const missing = findMissingAssetIds(next);
      if (missing.length > 0) {
        throw new DomainError("ASSET_NOT_FOUND", `Unknown asset references: ${missing.join(", ")}`);
      }
      return next;
    });
  };
}
