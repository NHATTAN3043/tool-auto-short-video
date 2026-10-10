import type { ProjectRepository, ProjectSummary } from "../ports/project-repository";

export function makeListProjects(deps: { repo: ProjectRepository }) {
  return (): Promise<ProjectSummary[]> => deps.repo.list();
}
