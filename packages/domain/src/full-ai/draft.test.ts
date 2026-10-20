import { describe, expect, it } from "vitest";

import { normalizeBriefQuestions, normalizeScriptOutline } from "../ai/normalize";
import { AiTaskSchema, type ScriptOutlineSuggestion } from "../ai/schema";
import { MODE_PRESETS } from "../project/presets";
import { project, scene } from "../testing/fixtures";
import {
  addOutlineScene,
  briefAnswers,
  briefKey,
  editOutlineScene,
  FullAiDraftSchema,
  isLongOutlineScene,
  isOutlineOverTarget,
  moveOutlineScene,
  newFullAiDraft,
  outlineSceneSeconds,
  removeOutlineScene,
  setDraftOther,
  setDraftOutline,
  setDraftQuestions,
  toFullAiOutline,
  toggleDraftChoice,
  type FullAiDraft,
} from "./draft";
import { applyFullAiOutline, assertFullAiRequest, fullAiSteps, isPaidFullAiStep } from "./plan";
import type { FullAiOutline } from "./schema";

const plan = { intent: "Mèo ngủ", preferredMedia: "video" as const, searchQueries: ["cat sleeping"] };

const outlineSuggestion: ScriptOutlineSuggestion = {
  title: "Mèo nhà bạn",
  scenes: [
    { narration: "Mèo ngủ mười sáu tiếng mỗi ngày.", visualPlan: plan },
    { narration: "Mèo không nếm được vị ngọt.", visualPlan: plan },
  ],
};

function ids() {
  let next = 0;
  return { newId: (prefix: string) => `${prefix}_${String((next += 1))}` };
}

function draft(): FullAiDraft {
  const base = { ...newFullAiDraft({ now: "2026-10-20T00:00:00.000Z" }), idea: "5 sự thật về mèo" };
  return setDraftQuestions(
    base,
    {
      questions: [
        { id: "q1", text: "Video cho ai?", kind: "single", options: ["Người nuôi mèo", "Trẻ em"] },
        { id: "q2", text: "Khía cạnh nào?", kind: "multi", options: ["Hành vi", "Cơ thể", "Lịch sử"] },
        { id: "q3", text: "Sự thật bắt buộc?", kind: "text", options: [] },
      ],
    },
    briefKey(base, "vi"),
  );
}

describe("brief questions", () => {
  it("cleans the AI's questions and numbers them", () => {
    const { questions } = normalizeBriefQuestions({
      questions: [
        { id: "x", text: "  ", kind: "single", options: ["A", "B"] },
        { id: "y", text: " Video  cho ai? ", kind: "single", options: [" A ", "a", "", "B"] },
        { id: "z", text: "Chỉ một lựa chọn", kind: "multi", options: ["A"] },
        { id: "w", text: "Tự do", kind: "text", options: ["bỏ"] },
      ],
    });
    expect(questions).toEqual([
      { id: "q1", text: "Video cho ai?", kind: "single", options: ["A", "B"] },
      { id: "q2", text: "Chỉ một lựa chọn", kind: "text", options: [] },
      { id: "q3", text: "Tự do", kind: "text", options: [] },
    ]);
  });

  it("accepts no questions at all", () => {
    expect(normalizeBriefQuestions({ questions: [] })).toEqual({ questions: [] });
  });

  it("parses the two new task types", () => {
    const input = { idea: "Mèo", targetDurationSec: 30 };
    expect(AiTaskSchema.parse({ type: "brief_questions", input }).type).toBe("brief_questions");
    expect(
      AiTaskSchema.parse({
        type: "script_outline",
        input: { ...input, answers: [{ question: "Cho ai?", answer: "Trẻ em" }] },
      }).type,
    ).toBe("script_outline");
  });
});

describe("normalizeScriptOutline", () => {
  it("keeps the narration of the video's language", () => {
    expect(normalizeScriptOutline(outlineSuggestion, "vi").scenes).toHaveLength(2);
  });

  it("refuses narration in another language", () => {
    expect(() =>
      normalizeScriptOutline(
        { title: "Cats", scenes: [{ narration: "Cats sleep sixteen hours a day.", visualPlan: plan }] },
        "vi",
      ),
    ).toThrow(expect.objectContaining({ code: "AI_INVALID_OUTPUT" }));
  });
});

describe("answers", () => {
  it("replaces a single choice and clears it when picked again", () => {
    let next = toggleDraftChoice(draft(), "q1", 0);
    next = toggleDraftChoice(next, "q1", 1);
    expect(briefAnswers(next)).toEqual([{ question: "Video cho ai?", answer: "Trẻ em" }]);
    next = toggleDraftChoice(next, "q1", 1);
    expect(briefAnswers(next)).toEqual([]);
  });

  it("toggles multiple choices and adds the free text of “Khác…”", () => {
    let next = toggleDraftChoice(draft(), "q2", 2);
    next = toggleDraftChoice(next, "q2", 0);
    next = setDraftOther(next, "q2", "Giấc ngủ");
    expect(briefAnswers(next)).toEqual([
      { question: "Khía cạnh nào?", answer: "Hành vi, Lịch sử, Giấc ngủ" },
    ]);
  });

  it("drops the options of a single choice when its own text is typed", () => {
    let next = toggleDraftChoice(draft(), "q1", 0);
    next = setDraftOther(next, "q1", "Sinh viên");
    expect(briefAnswers(next)).toEqual([{ question: "Video cho ai?", answer: "Sinh viên" }]);
  });

  it("reads free-text answers and skips empty ones", () => {
    const next = setDraftOther(draft(), "q3", "  mèo ngủ 16 tiếng ");
    expect(briefAnswers(next)).toEqual([{ question: "Sự thật bắt buộc?", answer: "mèo ngủ 16 tiếng" }]);
    expect(briefAnswers(setDraftOther(draft(), "q3", "   "))).toEqual([]);
  });

  it("ignores unknown questions and options", () => {
    const before = draft();
    expect(toggleDraftChoice(before, "nope", 0)).toBe(before);
    expect(toggleDraftChoice(before, "q1", 9)).toBe(before);
  });

  it("changes the brief key when the idea changes", () => {
    const before = draft();
    expect(briefKey({ ...before, idea: "5 sự thật về  mèo " }, "vi")).toBe(briefKey(before, "vi"));
    expect(briefKey({ ...before, idea: "Chó" }, "vi")).not.toBe(briefKey(before, "vi"));
    expect(briefKey(before, "en")).not.toBe(briefKey(before, "vi"));
  });
});

describe("outline editing", () => {
  const withOutline = () => setDraftOutline(draft(), outlineSuggestion, ids());

  it("keeps the visual plan only for narration that was not edited", () => {
    const edited = editOutlineScene(withOutline(), "ols_2", "Mèo không nếm được vị ngọt, lạ chưa.");
    const added = addOutlineScene(edited, null, ids());
    const outline = toFullAiOutline(added.outline ?? { title: "", scenes: [] });
    expect(outline?.scenes).toEqual([
      { narration: "Mèo ngủ mười sáu tiếng mỗi ngày.", visualPlan: plan },
      { narration: "Mèo không nếm được vị ngọt, lạ chưa." },
    ]);
  });

  it("adds after a scene, moves and removes scenes", () => {
    let next = addOutlineScene(withOutline(), "ols_1", { newId: () => "ols_new" });
    expect(next.outline?.scenes.map((s) => s.id)).toEqual(["ols_1", "ols_new", "ols_2"]);
    next = moveOutlineScene(next, "ols_2", -1);
    expect(next.outline?.scenes.map((s) => s.id)).toEqual(["ols_1", "ols_2", "ols_new"]);
    expect(moveOutlineScene(next, "ols_1", -1).outline?.scenes[0]?.id).toBe("ols_1");
    next = removeOutlineScene(next, "ols_new");
    expect(next.outline?.scenes.map((s) => s.id)).toEqual(["ols_1", "ols_2"]);
  });

  it("is null without any narration", () => {
    expect(toFullAiOutline({ title: "x", scenes: [{ id: "a", narration: "  " }] })).toBeNull();
  });

  it("estimates seconds and flags long scenes and long outlines", () => {
    expect(outlineSceneSeconds("")).toBe(0);
    expect(outlineSceneSeconds("Một hai ba bốn năm sáu bảy tám chín mười mười một mười hai mười ba")).toBe(6);
    const long = Array.from({ length: 30 }, () => "mèo").join(" ");
    expect(isLongOutlineScene(long)).toBe(true);
    expect(isOutlineOverTarget({ title: "", scenes: [{ id: "a", narration: long }] }, 10)).toBe(true);
    expect(isOutlineOverTarget({ title: "", scenes: [{ id: "a", narration: long }] }, 15)).toBe(false);
  });

  it("round-trips through the draft schema", () => {
    const next = withOutline();
    expect(FullAiDraftSchema.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
});

describe("runs with an approved outline", () => {
  const outline: FullAiOutline = {
    title: "Mèo",
    scenes: [{ narration: "Câu một.", visualPlan: plan }, { narration: "Câu hai." }],
  };

  it("skips the script and plans only the scenes without a visual plan", () => {
    expect(fullAiSteps(MODE_PRESETS.full_ai, { tts: true }, outline)).toEqual([
      "scenes",
      "visual",
      "media",
      "rank",
      "select",
      "voice",
    ]);
    expect(
      fullAiSteps(MODE_PRESETS.full_ai, { tts: false }, { ...outline, scenes: outline.scenes.slice(0, 1) }),
    ).toEqual(["scenes", "media", "rank", "select"]);
    expect(isPaidFullAiStep("scenes", MODE_PRESETS.full_ai, true)).toBe(false);
  });

  it("needs no idea nor script", () => {
    expect(() => {
      assertFullAiRequest(
        project({ script: "" }),
        { targetDurationSec: 30, rankingMode: "text", replaceScenes: false, outline },
        ["scenes"],
      );
    }).not.toThrow();
  });

  it("becomes the script and scenes, word for word", () => {
    const next = applyFullAiOutline(project({ scenes: [scene("old", "Cảnh cũ.")] }), outline, {
      newId: () => "scn_new",
    });
    expect(next.script).toBe("Câu một.\n\nCâu hai.");
    expect(next.scenes).toEqual([
      { id: "scn_new", narration: "Câu một.", visualPlan: plan, status: "draft" },
      { id: "scn_new", narration: "Câu hai.", status: "draft" },
    ]);
  });
});
