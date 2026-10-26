import { describe, expect, it } from "vitest";

import { AI_RANK_MAX_CANDIDATES, AiTaskSchema, type MediaRankRequest } from "../ai/schema";
import { normalizeMediaRanking, normalizeSceneRewrite } from "../ai/normalize";
import { orderByRanking, toRankCandidate } from "../ai/rank";
import { candidateKey, type MediaCandidate } from "../media/search";
import { MODE_PRESETS } from "../project/presets";
import { ProjectSchema } from "../project/schema";
import { project, scene } from "../testing/fixtures";
import { assertFullAiRequest, fullAiSteps, isPaidFullAiStep, setMediaRankingMode } from "./plan";
import { FullAiRequestSchema, type FullAiRequest } from "./schema";

const request: FullAiRequest = {
  idea: "Mèo đi học",
  targetDurationSec: 30,
  rankingMode: "text",
  replaceScenes: false,
};

describe("fullAiSteps", () => {
  it("runs every step in Full AI with a voice provider", () => {
    expect(fullAiSteps(MODE_PRESETS.full_ai, { tts: true })).toEqual([
      "script",
      "scenes",
      "media",
      "rank",
      "select",
      "voice",
    ]);
  });

  it("follows each toggle, not the mode", () => {
    expect(fullAiSteps(MODE_PRESETS.assisted, { tts: false })).toEqual(["scenes", "media"]);
    expect(
      fullAiSteps({ ...MODE_PRESETS.manual, visualKeywords: true, autoMediaSelection: true }, { tts: true }),
    ).toEqual(["scenes", "visual", "media", "select"]);
    expect(fullAiSteps(MODE_PRESETS.manual, { tts: true })).toEqual(["scenes"]);
  });

  it("knows which steps are paid", () => {
    expect(isPaidFullAiStep("scenes", MODE_PRESETS.full_ai)).toBe(true);
    expect(isPaidFullAiStep("scenes", MODE_PRESETS.manual)).toBe(false);
    expect(isPaidFullAiStep("media", MODE_PRESETS.full_ai)).toBe(false);
    expect(isPaidFullAiStep("voice", MODE_PRESETS.manual)).toBe(true);
  });
});

describe("assertFullAiRequest", () => {
  const steps = fullAiSteps(MODE_PRESETS.full_ai, { tts: true });

  it("needs an idea when the script is written by AI, otherwise a script", () => {
    expect(() => {
      assertFullAiRequest(project(), { ...request, idea: "x" }, steps);
    }).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(() => {
      assertFullAiRequest(project({ script: "" }), request, ["scenes"]);
    }).toThrow(expect.objectContaining({ code: "INVALID_OPERATION" }));
    expect(() => {
      assertFullAiRequest(project({ script: "Có script." }), { ...request, idea: undefined }, ["scenes"]);
    }).not.toThrow();
  });

  it("replaces existing scenes only when confirmed", () => {
    const withScenes = project({ scenes: [scene("s1", "Một.")] });
    expect(() => {
      assertFullAiRequest(withScenes, request, steps);
    }).toThrow(expect.objectContaining({ code: "INVALID_OPERATION" }));
    expect(() => {
      assertFullAiRequest(withScenes, { ...request, replaceScenes: true }, steps);
    }).not.toThrow();
  });

  it("validates the request shape", () => {
    expect(FullAiRequestSchema.safeParse({ ...request, targetDurationSec: 0 }).success).toBe(false);
    expect(FullAiRequestSchema.safeParse({ ...request, targetDurationSec: 1000 }).success).toBe(false);
    expect(FullAiRequestSchema.safeParse({ ...request, targetDurationSec: 999 }).success).toBe(true);
    expect(FullAiRequestSchema.safeParse({ ...request, rankingMode: "audio" }).success).toBe(false);
  });
});

describe("media ranking", () => {
  const candidate = (ref: string) => ({
    key: candidateKey({ provider: "pexels", kind: "video", ref }),
    kind: "video" as const,
    width: 1080,
    height: 1920,
    thumbnail: { type: "remote" as const, url: `https://images.pexels.com/${ref}.jpg` },
  });
  const rankRequest: MediaRankRequest = {
    mode: "text",
    scenes: [
      { sceneId: "s1", narration: "Một.", candidates: [candidate("a"), candidate("b"), candidate("c")] },
      { sceneId: "s2", narration: "Hai.", candidates: [candidate("d")] },
    ],
  };

  it("keeps the AI order, drops unknown and repeated keys and appends what it left out", () => {
    const result = normalizeMediaRanking(
      {
        scenes: [
          { sceneId: "s1", keys: ["pexels:video:c", "pexels:video:zzz", "pexels:video:c", "pexels:video:a"] },
          { sceneId: "s9", keys: ["pexels:video:d"] },
        ],
      },
      rankRequest,
    );
    expect(result).toEqual({
      scenes: [
        { sceneId: "s1", keys: ["pexels:video:c", "pexels:video:a", "pexels:video:b"] },
        { sceneId: "s2", keys: ["pexels:video:d"] },
      ],
    });
  });

  it("moves rejected candidates last and keeps only known rejected keys", () => {
    const result = normalizeMediaRanking(
      {
        scenes: [
          {
            sceneId: "s1",
            keys: ["pexels:video:a", "pexels:video:b", "pexels:video:c"],
            rejected: ["pexels:video:a", "pexels:video:zzz"],
          },
          { sceneId: "s2", keys: ["pexels:video:d"], rejected: [] },
        ],
      },
      rankRequest,
    );
    expect(result).toEqual({
      scenes: [
        {
          sceneId: "s1",
          keys: ["pexels:video:b", "pexels:video:c", "pexels:video:a"],
          rejected: ["pexels:video:a"],
        },
        { sceneId: "s2", keys: ["pexels:video:d"] },
      ],
    });
  });

  it("limits candidates and scenes per call", () => {
    const many = Array.from({ length: AI_RANK_MAX_CANDIDATES + 1 }, (_, i) => candidate(String(i)));
    expect(
      AiTaskSchema.safeParse({
        type: "rank_media",
        input: { mode: "vision", scenes: [{ sceneId: "s1", narration: "x", candidates: many }] },
      }).success,
    ).toBe(false);
  });

  it("orders candidates by a ranking and describes them for the AI", () => {
    const stock = (ref: string): MediaCandidate => ({
      provider: "pixabay",
      ref,
      kind: "image",
      width: 1080,
      height: 1920,
      description: `tag ${ref}`,
      thumbnail: { type: "remote", url: `https://cdn.pixabay.com/${ref}.jpg` },
    });
    const list = [stock("a"), stock("b"), stock("c")];
    expect(
      orderByRanking(list, ["pixabay:image:c", "pixabay:image:zzz", "pixabay:image:a"]).map((c) => c.ref),
    ).toEqual(["c", "a", "b"]);
    expect(toRankCandidate(stock("a"))).toEqual({
      key: "pixabay:image:a",
      kind: "image",
      width: 1080,
      height: 1920,
      description: "tag a",
      thumbnail: { type: "remote", url: "https://cdn.pixabay.com/a.jpg" },
    });
  });

  it("cleans up a rewritten narration", () => {
    expect(normalizeSceneRewrite({ narration: "  Câu   mới. " })).toEqual({ narration: "Câu mới." });
    expect(() => normalizeSceneRewrite({ narration: "   " })).toThrow();
  });
});

describe("ranking mode on the project", () => {
  it("is optional and remembered", () => {
    const p = project();
    expect(ProjectSchema.parse(p).mediaRankingMode).toBeUndefined();
    expect(ProjectSchema.parse(setMediaRankingMode(p, "vision")).mediaRankingMode).toBe("vision");
  });
});
