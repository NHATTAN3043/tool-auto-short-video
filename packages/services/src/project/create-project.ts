import {
  createProject,
  newId,
  type CreateProjectInput,
  type IdGenerator,
  type Project,
} from "@studio/domain";

import type { Clock } from "../ports/clock";
import type { ProjectRepository } from "../ports/project-repository";

export function makeCreateProject(deps: { repo: ProjectRepository; clock: Clock; newId?: IdGenerator }) {
  return (input: CreateProjectInput): Promise<Project> =>
    deps.repo.save(createProject(input, { now: deps.clock.now(), newId: deps.newId ?? newId }));
}
