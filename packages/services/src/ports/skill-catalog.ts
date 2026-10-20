import type { ContentLanguage, SkillGuidance, SkillId, SkillSummary } from "@studio/domain";

/** Installed skills (ADR 0012). Free and local: read from a folder, never from the browser. */
export interface SkillCatalogPort {
  /** Every usable skill, sorted by name. Broken or too long skills are left out. */
  list(): Promise<SkillSummary[]>;
  /**
   * The skill's content as sent to the AI, or null when it is not installed (or no longer usable). The copy
   * in `language` comes first when the skill has one; without it the Vietnamese copy is preferred.
   */
  get(id: SkillId, language?: ContentLanguage): Promise<SkillGuidance | null>;
}
