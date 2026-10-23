import { describe, expect, it } from "vitest";

import { candidateKey, type MediaCandidate } from "../media/search";
import { FullAiResultSchema } from "./schema";
import { scene } from "../testing/fixtures";
import { missingScenes, type SceneMediaOutcome } from "./missing-scenes";

const candidate = (ref: string): MediaCandidate => ({
  provider: "pexels",
  ref,
  kind: "video",
  width: 1080,
  height: 1920,
  thumbnail: { type: "remote", url: `https://images.example/${ref}.jpg` },
});

const plan = {
  intent: "A cat sleeping in the sun",
  preferredMedia: "video" as const,
  searchQueries: ["cat sleeping"],
  localizedQueries: { vi: ["mèo ngủ"], zh: ["猫睡觉"] },
};

describe("missingScenes", () => {
  const media = {
    assetId: "ast_1",
    sourceStartMs: 0,
    fit: "cover" as const,
    focusX: 0.5,
    volume: 0,
    kenBurns: false,
  };
  const scenes = [
    scene("a", "Có hình.", { media, visualPlan: plan }),
    scene("b", "Không ai tìm thấy.", { visualPlan: plan }),
    scene("c", "Bị loại hết."),
    scene("d", "Tải lỗi."),
  ];
  const outcomes = new Map<string, SceneMediaOutcome>([
    ["a", { candidates: [candidate("1")], rejected: new Set() }],
    ["b", { candidates: [], rejected: new Set() }],
    [
      "c",
      {
        candidates: [candidate("2"), candidate("3")],
        rejected: new Set(["2", "3"].map((ref) => candidateKey(candidate(ref)))),
      },
    ],
    [
      "d",
      { candidates: [candidate("4"), candidate("5")], rejected: new Set([candidateKey(candidate("4"))]) },
    ],
  ]);

  it("lists the scenes without media, in order, with the reason", () => {
    expect(missingScenes(scenes, outcomes).map(({ sceneId, reason }) => [sceneId, reason])).toEqual([
      ["b", "no_candidates"],
      ["c", "all_rejected"],
      ["d", "not_assigned"],
    ]);
  });

  it("treats a scene the media step never reached as having no candidates", () => {
    expect(missingScenes([scene("x", "Mới.")], new Map())[0]?.reason).toBe("no_candidates");
  });

  it("carries the intent and keywords in three languages, empty without a visual plan", () => {
    const [b, c] = missingScenes(scenes, outcomes);
    expect(b).toMatchObject({
      intent: plan.intent,
      queries: { en: ["cat sleeping"], vi: ["mèo ngủ"], zh: ["猫睡觉"] },
    });
    expect(c).toMatchObject({ intent: "", queries: { en: [], vi: [], zh: [] } });
  });

  it("keeps Full AI results saved without missing scenes valid", () => {
    expect(FullAiResultSchema.safeParse({ scenes: [], warnings: [] }).success).toBe(true);
    const withMissing = { scenes: [], warnings: [], missingScenes: missingScenes(scenes, outcomes) };
    expect(FullAiResultSchema.safeParse(withMissing).success).toBe(true);
  });
});
