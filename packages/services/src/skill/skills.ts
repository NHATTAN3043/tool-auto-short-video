import {
  DomainError,
  type AiTask,
  type ContentLanguage,
  type SkillGuidance,
  type SkillId,
} from "@studio/domain";

import type { SkillCatalogPort } from "../ports/skill-catalog";

/** Lists the installed skills for the picker. */
export function makeListSkills(deps: { skills: SkillCatalogPort }) {
  return () => deps.skills.list();
}

/** The skill a task asks for; ranking never uses one. */
export function taskSkillId(task: AiTask): SkillId | undefined {
  return task.type === "rank_media" ? undefined : task.input.skillId;
}

/** The narration language a task writes in, when it writes or splits narration (ADR 0013). */
export function taskLanguage(task: AiTask): ContentLanguage | undefined {
  return task.type === "rank_media" || task.type === "visual" ? undefined : task.input.language;
}

/** The skill's content, or undefined without a skill. A skill that is not installed is refused. */
export async function resolveSkill(
  skills: SkillCatalogPort | null,
  skillId: SkillId | undefined,
  language?: ContentLanguage,
): Promise<SkillGuidance | undefined> {
  if (skillId === undefined) return undefined;
  const guidance = skills ? await skills.get(skillId, language) : null;
  if (!guidance) throw new DomainError("INVALID_INPUT", `Không tìm thấy skill "${skillId}"`);
  return guidance;
}
