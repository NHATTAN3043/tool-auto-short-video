import type { AutomationMode, Project } from "@studio/domain";

export interface ProjectSummary {
  id: string;
  name: string;
  mode: AutomationMode;
  sceneCount: number;
  updatedAt: string;
}

export interface ProjectRepository {
  /** Throws DomainError PROJECT_NOT_FOUND. Always returns a migrated, validated project. */
  get(id: string): Promise<Project>;
  /** Most recently updated first. Unreadable projects are skipped. */
  list(): Promise<ProjectSummary[]>;
  /** Insert or replace. */
  save(project: Project): Promise<Project>;
  /**
   * Re-reads the stored project, applies `mutate` and writes the result. Calls for the same project run
   * one after another, so two concurrent uploads cannot overwrite each other's asset.
   */
  update(id: string, mutate: (project: Project) => Project): Promise<Project>;
  /** Deletes the project record only, not its files. Throws DomainError PROJECT_NOT_FOUND. */
  remove(id: string): Promise<void>;
}
