import { describe, expect, it } from "vitest";

import { setAiSkill } from "../full-ai/plan";
import { FullAiRequestSchema } from "../full-ai/schema";
import { createProject } from "../project/create-project";
import { ProjectSchema } from "../project/schema";
import { SkillIdSchema } from "./schema";

describe("skills", () => {
  it("accepts folder names only, so a request cannot name a path", () => {
    expect(SkillIdSchema.safeParse("viral-hooks").success).toBe(true);
    for (const bad of ["", "../secrets", "a/b", "Viral", "-x", "a".repeat(65)]) {
      expect(SkillIdSchema.safeParse(bad).success).toBe(false);
    }
    const request = { targetDurationSec: 30, rankingMode: "text", replaceScenes: false };
    expect(FullAiRequestSchema.safeParse({ ...request, skillId: "viral-hooks" }).success).toBe(true);
    expect(FullAiRequestSchema.safeParse({ ...request, skillId: "../x" }).success).toBe(false);
  });

  it("remembers the chosen skill in the project, optional for older files", () => {
    const project = createProject({ name: "P", mode: "full_ai" });
    expect(ProjectSchema.parse(project).aiSkillId).toBeUndefined();
    const chosen = setAiSkill(project, "viral-hooks");
    expect(ProjectSchema.parse(chosen).aiSkillId).toBe("viral-hooks");
    expect("aiSkillId" in setAiSkill(chosen, undefined)).toBe(false);
  });
});
