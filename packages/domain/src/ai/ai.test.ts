import { describe, expect, it } from "vitest";

import { DomainError } from "../errors";
import { MODE_PRESETS } from "../project/presets";
import type { VisualPlan } from "../scene/schema";
import { asset, project, scene } from "../testing/fixtures";
import { applyScenePlan, applyVisualPlans, assertAiTaskAllowed } from "./apply";
import {
  normalizeScenePlan,
  normalizeScriptSuggestion,
  normalizeVisualPlan,
  normalizeVisualPlans,
} from "./normalize";
import { AiTaskSchema } from "./schema";

const plan = (searchQueries: string[], intent = "  Cảnh   phố "): VisualPlan => ({
  intent,
  preferredMedia: "video",
  searchQueries,
});

describe("normalize AI output", () => {
  it("cleans visual plans: whitespace, empty and duplicate queries, at most six", () => {
    expect(normalizeVisualPlan(plan([" city  night ", "", "City Night", "a", "b", "c", "d", "e"]))).toEqual({
      intent: "Cảnh phố",
      preferredMedia: "video",
      searchQueries: ["city night", "a", "b", "c", "d", "e"],
    });
  });

  it("cleans Vietnamese and Chinese keywords the same way", () => {
    const result = normalizeVisualPlan({
      ...plan(["cat"]),
      localizedQueries: { vi: [" mèo  con ", "Mèo con", ""], zh: ["小猫", " 小猫 ", "猫咪"] },
    });
    expect(result.localizedQueries).toEqual({ vi: ["mèo con"], zh: ["小猫", "猫咪"] });
    expect(normalizeVisualPlan(plan(["cat"]))).not.toHaveProperty("localizedQueries");
  });

  it("keeps paragraph breaks of a script and rejects an empty one", () => {
    expect(normalizeScriptSuggestion({ title: " Tựa ", script: "Câu  một.\n\n\n  Câu hai. \n" })).toEqual({
      title: "Tựa",
      script: "Câu một.\n\nCâu hai.",
    });
    expect(() => normalizeScriptSuggestion({ title: "", script: " \n " })).toThrow(DomainError);
  });

  it("drops empty scenes and rejects a plan without any", () => {
    const result = normalizeScenePlan({
      scenes: [
        { narration: " Một. ", visualPlan: plan(["x"]) },
        { narration: "  ", visualPlan: plan([]) },
      ],
    });
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]?.narration).toBe("Một.");
    expect(() => normalizeScenePlan({ scenes: [{ narration: " ", visualPlan: plan([]) }] })).toThrow(
      /no scenes/u,
    );
  });

  it("keeps one visual plan per requested scene, in scene order", () => {
    const result = normalizeVisualPlans(
      {
        plans: [
          { sceneId: "b", visualPlan: plan(["b1"]) },
          { sceneId: "zzz", visualPlan: plan(["z"]) },
          { sceneId: "a", visualPlan: plan(["a1"]) },
          { sceneId: "a", visualPlan: plan(["a2"]) },
        ],
      },
      ["a", "b", "c"],
    );
    expect(result.plans.map((p) => [p.sceneId, p.visualPlan.searchQueries])).toEqual([
      ["a", ["a1"]],
      ["b", ["b1"]],
    ]);
    expect(() => normalizeVisualPlans({ plans: [{ sceneId: "x", visualPlan: plan([]) }] }, ["a"])).toThrow(
      DomainError,
    );
  });
});

describe("apply AI suggestions", () => {
  it("replaces scenes with the plan as new draft scenes", () => {
    let n = 0;
    const p = project({ scenes: [scene("old", "Cũ")] });
    const next = applyScenePlan(
      p,
      {
        scenes: [
          { narration: "Một.", visualPlan: plan(["q"]) },
          { narration: "Hai.", visualPlan: plan([]) },
        ],
      },
      { newId: (prefix) => `${prefix}_${String(++n)}` },
    );
    expect(next.scenes).toEqual([
      { id: "scn_1", narration: "Một.", status: "draft", visualPlan: { ...plan(["q"]), intent: "Cảnh phố" } },
      { id: "scn_2", narration: "Hai.", status: "draft", visualPlan: { ...plan([]), intent: "Cảnh phố" } },
    ]);
    expect(p.scenes[0]?.id).toBe("old");
  });

  it("sets only visual plans and leaves media, voice and narration alone", () => {
    const media = {
      assetId: "vid",
      sourceStartMs: 0,
      fit: "cover" as const,
      focusX: 0.5,
      volume: 0,
      kenBurns: false,
    };
    const p = project({
      assets: [asset("vid", "video"), asset("sv", "audio")],
      scenes: [scene("a", "Một.", { media, voiceAssetId: "sv" }), scene("b", "Hai.")],
    });
    const next = applyVisualPlans(p, { plans: [{ sceneId: "a", visualPlan: plan(["q"]) }] });
    expect(next.scenes[0]).toEqual({ ...p.scenes[0], visualPlan: { ...plan(["q"]), intent: "Cảnh phố" } });
    expect(next.scenes[1]).toBe(p.scenes[1]);
    expect(applyVisualPlans(p, { plans: [{ sceneId: "gone", visualPlan: plan([]) }] })).toBe(p);
  });

  it("allows each task only when its automation toggle is on", () => {
    const manual = project({ automationSettings: { ...MODE_PRESETS.manual } });
    expect(() => {
      assertAiTaskAllowed(manual, "script");
    }).toThrow(/scriptGeneration/u);
    const assisted = project({ automationSettings: { ...MODE_PRESETS.assisted } });
    expect(() => {
      assertAiTaskAllowed(assisted, "scenes");
    }).not.toThrow();
    expect(() => {
      assertAiTaskAllowed(assisted, "script");
    }).toThrow(DomainError);
  });

  it("validates task input", () => {
    expect(
      AiTaskSchema.safeParse({ type: "script", input: { idea: "Mèo", targetDurationSec: 30 } }).success,
    ).toBe(true);
    expect(
      AiTaskSchema.safeParse({ type: "script", input: { idea: "x", targetDurationSec: 5 } }).success,
    ).toBe(false);
    expect(AiTaskSchema.safeParse({ type: "visual", input: { script: "", scenes: [] } }).success).toBe(false);
  });
});
