import type { Project } from "@studio/domain";

import type { ProjectRepository } from "../ports/project-repository";

export function makeGetProject(deps: { repo: ProjectRepository }) {
  return (id: string): Promise<Project> => deps.repo.get(id);
}
