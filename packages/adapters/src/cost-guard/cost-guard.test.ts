import type { VoiceSettings } from "@studio/domain";
import { AiCallError } from "@studio/services";
import {
  FakeAi,
  FakeClock,
  FakeTts,
  InMemoryApiUsageLog,
  InMemoryBudgetSettings,
  NO_BUDGET_LIMITS,
} from "@studio/services/testing";
import { describe, expect, it } from "vitest";

import { BudgetCostGuard } from "./budget-cost-guard";
import { GuardedAi, GuardedTts } from "./guarded-ports";

const voice: VoiceSettings = {
  provider: "fake",
  voiceId: "v1",
  modelId: "m1",
  stability: 0.5,
  similarityBoost: 0.75,
  speed: 1,
};
const context = { projectId: "prj_1", jobId: "job_1" };
const scriptInput = { idea: "Mèo đi học", targetDurationSec: 30 };

function setup(defaults = NO_BUDGET_LIMITS) {
  const log = new InMemoryApiUsageLog();
  const settings = new InMemoryBudgetSettings();
  const clock = new FakeClock("2026-10-10T12:00:00.000Z");
  let n = 0;
  const guard = new BudgetCostGuard({ log, settings, defaults, clock, newId: () => `use_${String(++n)}` });
  const ai = new FakeAi();
  const tts = new FakeTts();
  return {
    log,
    settings,
    clock,
    guard,
    ai,
    tts,
    guardedAi: new GuardedAi(ai, guard, context),
    guardedTts: new GuardedTts(tts, guard, context),
  };
}

describe("GuardedAi", () => {
  it("logs a successful call with its real cost and tokens", async () => {
    const s = setup();
    await s.guardedAi.generateScript(scriptInput);
    expect(s.log.entries).toEqual([
      {
        id: "use_1",
        service: "ai",
        provider: "fake-ai",
        model: "fake-model",
        operation: "script",
        projectId: "prj_1",
        jobId: "job_1",
        status: "ok",
        estimatedUsd: 0.042,
        usd: 0.007,
        inputTokens: 1000,
        outputTokens: 500,
        createdAt: "2026-10-10T12:00:00.000Z",
      },
    ]);
  });

  it("logs a failed call that was still billed, and rethrows", async () => {
    const s = setup();
    s.ai.failWith = new AiCallError("AI_REFUSED", "refusal", {
      inputTokens: 10,
      outputTokens: 5,
      usd: 0.001,
    });
    await expect(s.guardedAi.planScenes({ script: "Một.", maxWordsPerScene: 18 })).rejects.toBe(
      s.ai.failWith,
    );
    expect(s.log.entries[0]).toMatchObject({
      status: "failed",
      operation: "scenes",
      usd: 0.001,
      message: "refusal",
    });
  });

  it("blocks without calling the provider when the worst case breaks a budget", async () => {
    const s = setup({ ...NO_BUDGET_LIMITS, perCallUsd: 0.01 });
    await expect(s.guardedAi.generateScript(scriptInput)).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
      message: expect.stringContaining("mỗi lần gọi") as unknown,
    });
    expect(s.ai.calls).toEqual([]);
    expect(s.log.entries[0]).toMatchObject({ status: "blocked", usd: 0, estimatedUsd: 0.042 });
  });

  it("counts earlier spend: day, month and project budgets", async () => {
    const s = setup({ ...NO_BUDGET_LIMITS, perProjectUsd: 0.05 });
    await s.guardedAi.generateScript(scriptInput); // 0.007 spent, next worst case 0.042 → 0.049
    await s.guardedAi.generateScript(scriptInput); // 0.014 + 0.042 > 0.05
    await expect(s.guardedAi.generateScript(scriptInput)).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    // Another project still has its own budget.
    await new GuardedAi(s.ai, s.guard, { projectId: "prj_2" }).generateScript(scriptInput);
    expect(s.log.entries.map((entry) => [entry.projectId, entry.status])).toEqual([
      ["prj_1", "ok"],
      ["prj_1", "ok"],
      ["prj_1", "blocked"],
      ["prj_2", "ok"],
    ]);
  });

  it("applies saved settings instead of the defaults, without a restart", async () => {
    const s = setup();
    await s.settings.save({
      schemaVersion: 1,
      limits: { ...NO_BUDGET_LIMITS, perDayUsd: 0 },
      updatedAt: "2026-10-10T00:00:00.000Z",
    });
    await expect(s.guardedAi.generateScript(scriptInput)).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("lets only one of two concurrent calls through when the budget fits one", async () => {
    const s = setup({ ...NO_BUDGET_LIMITS, perDayUsd: 0.05 });
    s.ai.usage = { inputTokens: 1000, outputTokens: 4000, usd: 0.042 };
    const results = await Promise.allSettled([
      s.guardedAi.generateScript(scriptInput),
      s.guardedAi.generateScript(scriptInput),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(s.ai.calls).toHaveLength(1);
  });

  it("guards ranking and rewriting like every other AI call", async () => {
    const s = setup();
    const candidate = {
      key: "pexels:video:1",
      kind: "video" as const,
      width: 1080,
      height: 1920,
      thumbnail: { type: "remote" as const, url: "https://images.pexels.com/1.jpg" },
    };
    await s.guardedAi.rankMedia(
      { mode: "text", scenes: [{ sceneId: "s1", narration: "Một.", candidates: [candidate] }] },
      new Map(),
    );
    await s.guardedAi.rewriteScene({ script: "", narration: "Một." });
    expect(s.log.entries.map((entry) => [entry.operation, entry.status])).toEqual([
      ["rank_media", "ok"],
      ["rewrite_scene", "ok"],
    ]);
  });

  it("does not log free estimates", async () => {
    const s = setup();
    await s.guardedAi.estimate({ type: "script", input: scriptInput });
    expect(s.log.entries).toEqual([]);
  });
});

describe("GuardedTts", () => {
  it("logs each synthesis with its characters and cost", async () => {
    const s = setup();
    await s.guardedTts.synthesize("Xin chào", voice);
    expect(s.log.entries[0]).toMatchObject({
      service: "tts",
      provider: "fake",
      model: "m1",
      operation: "speech",
      status: "ok",
      characters: 8,
      usd: 8 * 0.5 * 0.0006,
    });
  });

  it("logs failures as unbilled and blocks over budget", async () => {
    const s = setup({ ...NO_BUDGET_LIMITS, perMonthUsd: 0.003 });
    s.tts.failFor.add("Lỗi");
    await expect(s.guardedTts.synthesize("Lỗi", voice)).rejects.toThrow("provider failed");
    await expect(s.guardedTts.synthesize("Một câu khá dài", voice)).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
    });
    expect(s.log.entries.map((entry) => [entry.status, entry.usd])).toEqual([
      ["failed", 0],
      ["blocked", 0],
    ]);
    expect(s.tts.calls.map((call) => call.text)).toEqual(["Lỗi"]);
  });
});
