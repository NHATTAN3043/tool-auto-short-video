import { createProject, type Project } from "@studio/domain";
import { describe, expect, it } from "vitest";

import type { AiEstimate } from "./api";
import { costLine, formatUsd, hasAllKeywords, parseQueries, sceneNumbers, visualTask } from "./model";

const estimate: AiEstimate = {
  model: "claude-sonnet-5-5",
  inputTokens: 1000,
  expectedOutputTokens: 500,
  maxOutputTokens: 4000,
  expectedUsd: 0.007,
  maxUsd: 0.042,
  budget: {
    allowed: true,
    blockedBy: null,
    limits: { perCallUsd: null, perDayUsd: 0.5, perMonthUsd: null, perProjectUsd: null },
    spent: { dayUsd: 0.02, monthUsd: 0.02, projectUsd: 0.02 },
    planned: { totalUsd: 0.042, maxCallUsd: 0.042 },
  },
};

const project = (): Project => ({
  ...createProject({ name: "P", mode: "full_ai" }, { newId: () => "prj_1" }),
  script: "Toàn bộ.",
  scenes: [
    { id: "a", narration: "Một.", status: "draft" },
    { id: "b", narration: "  ", status: "draft" },
    {
      id: "c",
      narration: "Ba.",
      status: "draft",
      visualPlan: { intent: "x", preferredMedia: "video", searchQueries: ["cat"] },
    },
    {
      id: "d",
      narration: "Bốn.",
      status: "draft",
      visualPlan: {
        intent: "x",
        preferredMedia: "video",
        searchQueries: ["cat"],
        localizedQueries: { vi: ["mèo"], zh: ["猫"] },
      },
    },
  ],
});

describe("AI model", () => {
  it("formats the cost line", () => {
    expect(formatUsd(0.0004)).toBe("< 0,001 USD");
    expect(costLine(estimate)).toBe("≈ 0,007 USD (tối đa 0,042 USD) · claude-sonnet-5-5");
  });

  it("builds the visual task from scenes with narration, optionally only those missing keywords", () => {
    expect(visualTask(project(), false)).toEqual({
      type: "visual",
      input: {
        script: "Toàn bộ.",
        scenes: [
          { id: "a", narration: "Một." },
          { id: "c", narration: "Ba." },
          { id: "d", narration: "Bốn." },
        ],
      },
    });
    // "c" has English keywords only, so it is redone to get Vietnamese and Chinese ones.
    expect(visualTask(project(), true)?.input.scenes).toEqual([
      { id: "a", narration: "Một." },
      { id: "c", narration: "Ba." },
    ]);
    expect(hasAllKeywords(project().scenes[3]?.visualPlan)).toBe(true);
    expect(hasAllKeywords(undefined)).toBe(false);
    expect(visualTask({ ...project(), scenes: [] }, false)).toBeNull();
  });

  it("parses typed search queries and numbers scenes", () => {
    expect(parseQueries(" cat ,  kitten  playing,, ")).toEqual(["cat", "kitten playing"]);
    expect(sceneNumbers(project(), ["c", "a"])).toBe("1, 3");
  });
});
