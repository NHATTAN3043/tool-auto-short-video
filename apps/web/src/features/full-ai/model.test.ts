import {
  createProject,
  MODE_PRESETS,
  setDraftOutline,
  setDraftQuestions,
  toggleDraftChoice,
  type FullAiResult,
  type MediaCandidate,
  type Project,
  type RenderJob,
  type SkillSummary,
} from "@studio/domain";
import { describe, expect, it } from "vitest";

import type { FullAiEstimate } from "./api";
import {
  alternativesFor,
  MISSING_REASON_LABELS,
  reviewSceneAnchor,
  stillMissing,
  approveRequest,
  briefTask,
  costLines,
  ideaError,
  initialDraft,
  isRunning,
  outlineSceneLabel,
  outlineTask,
  parseDuration,
  progressLine,
  quickRequest,
  rememberedSkill,
  reviewStats,
  rewriteTask,
  runUsesSkill,
  skillHint,
  stepsLine,
  withInstalledSkill,
} from "./model";

const hooks: SkillSummary = { id: "viral-hooks", name: "viral-hooks", description: "Hooks", language: "en" };
const tiktok: SkillSummary = { id: "viral-tiktok", name: "viral-tiktok", description: "", language: "vi" };

const base = (): Project => ({
  ...createProject({ name: "P", mode: "full_ai" }, { newId: () => "prj_1" }),
  automationSettings: { ...MODE_PRESETS.full_ai },
});

const job = (extra: Partial<RenderJob>): RenderJob => ({
  id: "job_1",
  projectId: "prj_1",
  kind: "full_ai",
  status: "PROCESSING",
  progress: 0.4,
  createdAt: "2026-10-10T00:00:00.000Z",
  fullAi: {
    request: { idea: "Mèo", targetDurationSec: 30, rankingMode: "text", replaceScenes: false },
    steps: ["script", "scenes", "voice"],
    maxUsd: 0.5,
  },
  ...extra,
});

const NOW = "2026-10-20T00:00:00.000Z";
const plan = { intent: "Mèo", preferredMedia: "video" as const, searchQueries: ["cat"] };

describe("Full AI draft", () => {
  it("starts from the remembered ranking mode and skill, while the skill is installed", () => {
    expect(initialDraft(base(), [], NOW).rankingMode).toBe("text");
    const project = { ...base(), mediaRankingMode: "vision" as const, aiSkillId: "viral-hooks" };
    expect(initialDraft(project, [hooks, tiktok], NOW)).toMatchObject({
      rankingMode: "vision",
      skillId: "viral-hooks",
    });
    expect(initialDraft(project, [tiktok], NOW).skillId).toBeUndefined();
    expect(rememberedSkill(base(), [hooks])).toBeUndefined();
    const saved = { ...initialDraft(base(), [], NOW), skillId: "viral-hooks" };
    expect(withInstalledSkill(saved, [tiktok]).skillId).toBeUndefined();
    expect(withInstalledSkill(saved, [hooks])).toBe(saved);
  });

  it("needs an idea when AI writes the script, otherwise the project's script", () => {
    const draft = { ...initialDraft(base(), [], NOW), idea: "ab" };
    expect(ideaError(draft, base())).toContain("ý tưởng");
    expect(ideaError({ ...draft, idea: "Mèo đi học" }, base())).toBeNull();
    const noScript = { ...base(), automationSettings: { ...MODE_PRESETS.assisted, scriptGeneration: false } };
    expect(ideaError(draft, noScript)).toContain("Viết script trước");
    expect(ideaError(draft, { ...noScript, script: "Có script." })).toBeNull();
  });

  it("asks the questions, then writes the outline from the answers or a remark", () => {
    const draft = { ...initialDraft(base(), [hooks], NOW), idea: " Mèo ", tone: " ", skillId: "viral-hooks" };
    expect(briefTask(draft, "en")).toEqual({
      type: "brief_questions",
      input: { idea: "Mèo", targetDurationSec: 30, skillId: "viral-hooks", language: "en" },
    });
    const asked = toggleDraftChoice(
      setDraftQuestions(
        draft,
        { questions: [{ id: "q1", text: "Cho ai?", kind: "single", options: ["Trẻ em"] }] },
        "k",
      ),
      "q1",
      0,
    );
    expect(outlineTask(asked, "vi")).toMatchObject({
      type: "script_outline",
      input: { answers: [{ question: "Cho ai?", answer: "Trẻ em" }] },
    });
    const outlined = setDraftOutline(asked, {
      title: "Mèo",
      scenes: [{ narration: "Câu một.", visualPlan: plan }],
    });
    expect(outlineTask(outlined, "vi", " ngắn hơn ")).toMatchObject({
      input: { revision: { feedback: "ngắn hơn", scenes: ["Câu một."] } },
    });
    const plain = outlineTask(outlined, "vi", "  ");
    expect(plain.type === "script_outline" ? plain.input.revision : "missing").toBeUndefined();
    const sceneId = outlined.outline?.scenes[0]?.id ?? "";
    expect(rewriteTask(outlined, sceneId, "vi")).toMatchObject({
      type: "rewrite_scene",
      input: { script: "Câu một.", narration: "Câu một.", skillId: "viral-hooks" },
    });
    expect(rewriteTask(outlined, "nope", "vi")).toBeNull();
  });

  it("sends the approved outline, or the old run when the questions are skipped", () => {
    const draft = setDraftOutline(
      { ...initialDraft(base(), [], NOW), idea: "Mèo" },
      { title: "Mèo", scenes: [{ narration: "Câu một.", visualPlan: plan }] },
    );
    expect(approveRequest(draft, "vi")).toEqual({
      idea: "Mèo",
      targetDurationSec: 30,
      rankingMode: "text",
      language: "vi",
      outline: { title: "Mèo", scenes: [{ narration: "Câu một.", visualPlan: plan }] },
      replaceScenes: false,
    });
    expect(approveRequest({ ...draft, outline: { title: "", scenes: [] } }, "vi")).toBeNull();
    // No step of this run sends the skill: it stays out of the request.
    const splitOnly = { ...base(), automationSettings: { ...MODE_PRESETS.full_ai, scenePlanning: false } };
    const quick = quickRequest({ ...draft, skillId: "viral-hooks" }, splitOnly, ["scenes", "media"], "en");
    expect(quick).toEqual({
      idea: "Mèo",
      targetDurationSec: 30,
      rankingMode: "text",
      language: "en",
      replaceScenes: false,
    });
  });

  it("names the scenes of an outline", () => {
    expect([0, 1, 2, 3].map((index) => outlineSceneLabel(index, 4))).toEqual(["Mở đầu", "Ý 1", "Ý 2", "Kết"]);
    expect([0, 1].map((index) => outlineSceneLabel(index, 2))).toEqual(["Mở đầu", "Ý 1"]);
  });
});

describe("Full AI skill", () => {
  it("is offered only when a step sends it: script, AI scene planning or keywords", () => {
    const settings = MODE_PRESETS.full_ai;
    expect(runUsesSkill(["script", "scenes"], settings)).toBe(true);
    expect(runUsesSkill(["scenes", "visual"], { ...settings, scenePlanning: false })).toBe(true);
    expect(runUsesSkill(["scenes", "media"], { ...settings, scenePlanning: true })).toBe(true);
    expect(runUsesSkill(["scenes", "media"], { ...settings, scenePlanning: false })).toBe(false);
  });

  it("warns that English skills are still held to Vietnamese", () => {
    expect(skillHint(undefined)).toBe("Không gửi kèm skill.");
    expect(skillHint(hooks)).toContain("tiếng Việt");
    expect(skillHint(tiktok)).toContain("SKILL.vi.md");
    expect(skillHint(tiktok, "en")).toContain("không phải tiếng Anh");
  });
});

describe("Full AI progress", () => {
  it("names the steps and the current one", () => {
    expect(stepsLine(["script", "scenes", "voice"])).toBe("Viết script → Chia cảnh → Tạo giọng");
    expect(progressLine(job({ status: "QUEUED" }))).toBe("Đang chờ worker…");
    expect(progressLine(job({}))).toBe("Đang bắt đầu… · 40%");
    const info = job({}).fullAi;
    if (!info) throw new Error("the fixture has Full AI info");
    expect(progressLine(job({ fullAi: { ...info, step: "scenes" } }))).toBe("Bước 2/3: Chia cảnh · 40%");
    expect(isRunning(job({}))).toBe(true);
    expect(isRunning(job({ status: "FAILED" }))).toBe(false);
    expect(isRunning(null)).toBe(false);
  });

  it("lists the cost of each paid step", () => {
    const estimate: FullAiEstimate = {
      steps: ["script", "scenes", "media"],
      costs: [{ step: "script", expectedUsd: 0.005, maxUsd: 0.04 }],
      sceneCount: 5,
      expectedUsd: 0.005,
      maxUsd: 0.04,
      budget: {
        allowed: true,
        blockedBy: null,
        limits: { perCallUsd: null, perDayUsd: null, perMonthUsd: null, perProjectUsd: null },
        spent: { dayUsd: 0, monthUsd: 0, projectUsd: 0 },
        planned: { totalUsd: 0.04, maxCallUsd: 0.04 },
      },
    };
    expect(costLines(estimate)).toEqual(["Viết script: ≈ 0,005 USD (tối đa 0,040 USD)"]);
  });
});

describe("review", () => {
  const candidate = (ref: string): MediaCandidate => ({
    provider: "pexels",
    ref,
    kind: "video",
    width: 1080,
    height: 1920,
    thumbnail: { type: "remote", url: `https://images.pexels.com/${ref}.jpg` },
  });

  const project = (): Project => ({
    ...base(),
    voice: { provider: "fake", voiceId: "v", modelId: "m", stability: 0.5, similarityBoost: 0.75, speed: 1 },
    assets: [
      {
        id: "ast_1",
        kind: "video",
        source: "pexels",
        fileName: "pexels-a.mp4",
        path: "media/ast_1.mp4",
        createdAt: "2026-10-10T00:00:00.000Z",
      },
    ],
    scenes: [
      {
        id: "s1",
        narration: "Một.",
        status: "approved",
        media: { assetId: "ast_1", sourceStartMs: 0, fit: "cover", focusX: 0.5, volume: 0, kenBurns: false },
      },
      { id: "s2", narration: "Hai.", status: "draft" },
    ],
  });

  it("counts kept scenes, media and voices to redo", () => {
    expect(reviewStats(project())).toEqual({ total: 2, approved: 1, withMedia: 1, voiceToRedo: 2 });
  });

  it("offers the ranked candidates a scene does not use yet", () => {
    const result: FullAiResult = {
      scenes: [{ sceneId: "s1", candidates: [candidate("a"), candidate("b")] }],
      warnings: [],
    };
    expect(alternativesFor(result, project(), "s1").map((c) => c.ref)).toEqual(["b"]);
    expect(alternativesFor(result, project(), "s2")).toEqual([]);
    expect(alternativesFor(null, project(), "s1")).toEqual([]);
  });

  it("lists the scenes the run left empty that are still empty, numbered (ADR 0019)", () => {
    const missing = (sceneId: string) => ({
      sceneId,
      reason: "no_candidates" as const,
      intent: "Mèo",
      queries: { en: ["cat"], vi: ["mèo"], zh: [] },
    });
    const result: FullAiResult = {
      scenes: [],
      warnings: [],
      // s1 got media since, s9 was deleted: only s2 is left.
      missingScenes: [missing("s1"), missing("s2"), missing("s9")],
    };
    expect(stillMissing(result, project())).toEqual([{ ...missing("s2"), number: 2 }]);
    expect(stillMissing({ scenes: [], warnings: [] }, project())).toEqual([]);
    expect(stillMissing(null, project())).toEqual([]);
    expect(MISSING_REASON_LABELS.all_rejected).toBe("AI thấy không media nào hợp");
    expect(reviewSceneAnchor("s2")).toBe("review-scene-s2");
  });
});

describe("parseDuration", () => {
  it("takes whole seconds above 0 and below 1000", () => {
    expect(parseDuration(" 75 ")).toEqual({ seconds: 75 });
    expect(parseDuration("999")).toEqual({ seconds: 999 });
    for (const text of ["0", "1000", "", "12.5", "-3", "abc"]) {
      expect(parseDuration(text)).toHaveProperty("error");
    }
  });
});
