import { z } from "zod";

// Skills (ADR 0012): expert notes (`SKILL.md`) sent to the AI with the script, keyword and rewrite tasks.
// Requests carry only the id; the server and the worker read the content from the skill folder.

/** The skill's folder name. Also what keeps a request from naming a path outside the folder. */
export const SkillIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u, "invalid skill id");
export type SkillId = z.infer<typeof SkillIdSchema>;

/** Longer skills are not offered: each AI call would carry them. About 12k tokens of English. */
export const SKILL_MAX_CHARS = 40_000;

export const SkillLanguageSchema = z.enum(["vi", "en"]);
export type SkillLanguage = z.infer<typeof SkillLanguageSchema>;

/** What the skill picker shows. */
export const SkillSummarySchema = z.object({
  id: SkillIdSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000),
  /** `vi` when the folder has a Vietnamese copy (`SKILL.vi.md`), which is then the one sent. */
  language: SkillLanguageSchema,
});
export type SkillSummary = z.infer<typeof SkillSummarySchema>;

/** A skill as sent to the AI. */
export const SkillGuidanceSchema = SkillSummarySchema.extend({
  content: z.string().trim().min(1).max(SKILL_MAX_CHARS),
});
export type SkillGuidance = z.infer<typeof SkillGuidanceSchema>;
