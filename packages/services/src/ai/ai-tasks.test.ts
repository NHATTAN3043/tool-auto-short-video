import {
  applyScenePlan,
  createProject,
  DomainError,
  MODE_PRESETS,
  type AiTask,
  type AutomationSettings,
} from "@studio/domain";
import { describe, expect, it } from "vitest";

import { AiCallError } from "../ports/ai";
import { makeRunNextRenderJob } from "../render/run-next-render-job";
import {
  FakeAi,
  FakeClock,
  FakeCostGuard,
  FakeSkillCatalog,
  InMemoryJobQueue,
  InMemoryProjectRepository,
  InMemoryStorage,
} from "../testing";
import { makeEstimateAiTask } from "./estimate-ai-task";
import { makeGetAiResult } from "./get-ai-result";
import { makeRequestAiTask } from "./request-ai-task";
import { makeRunAiTask } from "./run-ai-task";

const scriptTask: AiTask = { type: "script", input: { idea: "Mèo đi học", targetDurationSec: 30 } };
const scenesTask: AiTask = { type: "scenes", input: { script: "Câu một. Câu hai.", maxWordsPerScene: 18 } };

async function setup(options: { settings?: AutomationSettings } = {}) {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const clock = new FakeClock("2026-10-10T12:00:00.000Z");
  const queue = new InMemoryJobQueue(clock);
  const ai = new FakeAi();
  const costGuard = new FakeCostGuard(undefined, clock);
  await repo.save({
    ...createProject({ name: "P", mode: "full_ai" }, { newId: () => "prj_1" }),
    ...(options.settings && { automationSettings: options.settings }),
  });
  let jobs = 0;
  const skills = new FakeSkillCatalog([
    { id: "viral-hooks", name: "viral-hooks", description: "Hooks", language: "en" },
  ]);
  const deps = { repo, ai, queue, clock, costGuard, skills };
  const runAiTask = makeRunAiTask({ ai: () => ai, storage, skills });
  return {
    costGuard,
    repo,
    storage,
    clock,
    queue,
    ai,
    skills,
    estimate: makeEstimateAiTask(deps),
    request: makeRequestAiTask({ ...deps, newId: () => `job_${String(++jobs)}` }),
    getResult: makeGetAiResult({ queue, storage }),
    run: makeRunNextRenderJob({
      queue,
      renderProject: () => Promise.reject(new Error("not a render")),
      exportCapcut: () => Promise.reject(new Error("not a render")),
      runAiTask,
      clock,
    }),
  };
}

describe("AI tasks", () => {
  it("estimates without a paid call and reports the budgets", async () => {
    const s = await setup();
    s.costGuard.limits = { ...s.costGuard.limits, perDayUsd: 0.5 };
    const estimate = await s.estimate({ projectId: "prj_1", task: scriptTask });
    expect(estimate).toMatchObject({
      model: "fake-model",
      expectedUsd: 0.007,
      maxUsd: 0.042,
      budget: {
        allowed: true,
        blockedBy: null,
        limits: { perDayUsd: 0.5 },
        spent: { dayUsd: 0, monthUsd: 0, projectUsd: 0 },
        planned: { totalUsd: 0.042, maxCallUsd: 0.042 },
      },
    });
    expect(s.ai.calls).toEqual([]);
  });

  it("refuses tasks whose automation toggle is off", async () => {
    const s = await setup({ settings: { ...MODE_PRESETS.assisted } });
    await expect(s.request({ projectId: "prj_1", task: scriptTask })).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
    await expect(s.request({ projectId: "prj_1", task: scenesTask })).resolves.toMatchObject({ kind: "ai" });
  });

  it("suggests keywords for one scene even in Manual mode, when the user asks from that scene", async () => {
    const s = await setup({ settings: { ...MODE_PRESETS.manual } });
    const scenes = [{ id: "scn_1", narration: "Mèo con chơi đùa trong vườn." }];
    await expect(
      s.request({ projectId: "prj_1", task: { type: "visual", input: { script: "", scenes } } }),
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    await expect(
      s.request({
        projectId: "prj_1",
        task: { type: "visual", input: { script: "", scenes, onDemand: true } },
      }),
    ).resolves.toMatchObject({ kind: "ai" });
  });

  it("queues a job that records the worst case, and returns the same job for the same task", async () => {
    const s = await setup();
    const job = await s.request({ projectId: "prj_1", task: scriptTask });
    expect(job).toMatchObject({ kind: "ai", status: "QUEUED", ai: { task: scriptTask, maxUsd: 0.042 } });
    expect((await s.request({ projectId: "prj_1", task: scriptTask })).id).toBe(job.id);
    expect((await s.request({ projectId: "prj_1", task: scenesTask })).id).not.toBe(job.id);
  });

  it("runs the job in the worker, stores a normalized suggestion and records the real cost", async () => {
    const s = await setup();
    s.ai.scenes = {
      scenes: [
        {
          narration: " Một. ",
          visualPlan: { intent: "x", preferredMedia: "video", searchQueries: ["a", "A", ""] },
        },
        { narration: " ", visualPlan: { intent: "", preferredMedia: "image", searchQueries: [] } },
      ],
    };
    const job = await s.request({ projectId: "prj_1", task: scenesTask });
    const done = await s.run();
    expect(done).toMatchObject({
      id: job.id,
      status: "COMPLETED",
      outputPath: `ai/${job.id}.json`,
      ai: { costUsd: 0.007 },
    });
    const result = await s.getResult({ projectId: "prj_1", jobId: job.id });
    expect(result).toEqual({
      type: "scenes",
      suggestion: {
        scenes: [
          { narration: "Một.", visualPlan: { intent: "x", preferredMedia: "video", searchQueries: ["a"] } },
        ],
      },
      usage: s.ai.usage,
    });
    // The project itself is untouched until the user applies the suggestion.
    expect((await s.repo.get("prj_1")).scenes).toEqual([]);
  });

  it("idea → script → scenes with search queries, without editing JSON (M9 acceptance)", async () => {
    const s = await setup();
    const scriptJob = await s.request({ projectId: "prj_1", task: scriptTask });
    await s.run();
    const script = await s.getResult({ projectId: "prj_1", jobId: scriptJob.id });
    if (script.type !== "script") throw new Error("expected a script");

    const plan = await s.request({
      projectId: "prj_1",
      task: { type: "scenes", input: { script: script.suggestion.script, maxWordsPerScene: 18 } },
    });
    await s.run();
    const scenes = await s.getResult({ projectId: "prj_1", jobId: plan.id });
    if (scenes.type !== "scenes") throw new Error("expected scenes");

    const project = applyScenePlan(await s.repo.get("prj_1"), scenes.suggestion);
    expect(project.scenes.map((scene) => [scene.narration, scene.visualPlan?.searchQueries])).toEqual([
      ["Câu một.", ["cat"]],
      ["Câu hai.", ["dog"]],
    ]);
  });

  it("maps visual plans back to the requested scenes", async () => {
    const s = await setup();
    const job = await s.request({
      projectId: "prj_1",
      task: { type: "visual", input: { script: "", scenes: [{ id: "scn_a", narration: "Một." }] } },
    });
    await s.run();
    const result = await s.getResult({ projectId: "prj_1", jobId: job.id });
    expect(result).toMatchObject({ type: "visual", suggestion: { plans: [{ sceneId: "scn_a" }] } });
  });

  it("fails the job with a Vietnamese message and still records a billed failure", async () => {
    const s = await setup();
    s.ai.failWith = new AiCallError("AI_REFUSED", "refusal", {
      inputTokens: 10,
      outputTokens: 5,
      usd: 0.001,
    });
    const job = await s.request({ projectId: "prj_1", task: scriptTask });
    const done = await s.run();
    expect(done).toMatchObject({ status: "FAILED", ai: { costUsd: 0.001 } });
    expect(done?.errorMessage).toMatch(/từ chối/u);
    await expect(s.getResult({ projectId: "prj_1", jobId: job.id })).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
  });

  it("refuses to queue a task whose worst case breaks a budget, with the reason", async () => {
    const s = await setup();
    s.costGuard.limits = { ...s.costGuard.limits, perCallUsd: 0.01 };
    await expect(s.request({ projectId: "prj_1", task: scriptTask })).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
      message: expect.stringContaining("mỗi lần gọi") as unknown,
    });
    expect(await s.queue.list()).toEqual([]);
    expect((await s.estimate({ projectId: "prj_1", task: scriptTask })).budget.blockedBy).toBe("call");
  });

  it("fails the job with the budget message when the worker's CostGuard blocks the call", async () => {
    const s = await setup();
    const job = await s.request({ projectId: "prj_1", task: scriptTask });
    const blocked = new FakeAi();
    blocked.generateScript = () =>
      Promise.reject(new DomainError("BUDGET_EXCEEDED", "Vượt ngân sách tháng này"));
    const run = makeRunNextRenderJob({
      queue: s.queue,
      renderProject: () => Promise.reject(new Error("x")),
      exportCapcut: () => Promise.reject(new Error("x")),
      runAiTask: makeRunAiTask({ ai: () => blocked, storage: s.storage }),
      clock: s.clock,
    });
    expect(await run()).toMatchObject({
      id: job.id,
      status: "FAILED",
      errorMessage: "Vượt ngân sách tháng này",
      ai: { costUsd: 0 },
    });
  });

  it("only returns results of finished AI jobs of the same project", async () => {
    const s = await setup();
    const job = await s.request({ projectId: "prj_1", task: scriptTask });
    await expect(s.getResult({ projectId: "prj_1", jobId: job.id })).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
    await s.run();
    await expect(s.getResult({ projectId: "prj_other", jobId: job.id })).rejects.toMatchObject({
      code: "JOB_NOT_FOUND",
    });
  });

  it("fails clearly when the worker has no AI provider", async () => {
    const s = await setup();
    await s.request({ projectId: "prj_1", task: scriptTask });
    const run = makeRunNextRenderJob({
      queue: s.queue,
      renderProject: () => Promise.reject(new Error("x")),
      exportCapcut: () => Promise.reject(new Error("x")),
      runAiTask: null,
      clock: s.clock,
    });
    expect((await run())?.errorMessage).toContain("ANTHROPIC_API_KEY");
  });

  it("sends the skill a rewrite names, counted in the estimate", async () => {
    const s = await setup();
    const task: AiTask = {
      type: "rewrite_scene",
      input: { script: "", narration: "Mèo ngủ rất nhiều mỗi ngày.", skillId: "viral-hooks" },
    };
    await s.estimate({ projectId: "prj_1", task });
    expect(s.ai.estimateGuidance.map((guidance) => guidance?.id)).toEqual(["viral-hooks"]);
    await s.request({ projectId: "prj_1", task });
    expect(await s.run()).toMatchObject({ status: "COMPLETED" });
    expect(s.ai.guidance.map((guidance) => guidance?.content)).toEqual(["Hướng dẫn của viral-hooks"]);
  });

  it("refuses a skill that is not installed, and fails a job whose skill was removed", async () => {
    const s = await setup();
    const task: AiTask = {
      type: "script",
      input: { idea: "Mèo đi học", targetDurationSec: 30, skillId: "nope" },
    };
    await expect(s.estimate({ projectId: "prj_1", task })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await s.request({
      projectId: "prj_1",
      task: { type: "script", input: { idea: "Mèo đi học", targetDurationSec: 30, skillId: "viral-hooks" } },
    });
    s.skills.skills.clear();
    const done = await s.run();
    expect(done).toMatchObject({ status: "FAILED" });
    expect(done?.errorMessage).toContain("viral-hooks");
    expect(s.ai.calls).toEqual([]);
  });

  it("writes in the project language whatever the browser sent", async () => {
    const s = await setup();
    await s.repo.update("prj_1", (project) => ({ ...project, language: "en" }));
    s.ai.script = { title: "Cats", script: "Did you know that cats sleep for most of the day?" };
    await s.request({
      projectId: "prj_1",
      task: { type: "script", input: { idea: "Cats at school", targetDurationSec: 30, language: "vi" } },
    });
    expect(await s.run()).toMatchObject({ status: "COMPLETED" });
    expect(s.ai.calls[0]).toMatchObject({ type: "script", input: { language: "en" } });
  });

  it("drops a rewrite that is not Vietnamese", async () => {
    const s = await setup();
    await s.request({
      projectId: "prj_1",
      task: {
        type: "rewrite_scene",
        input: { script: "", narration: "Cats sleep a lot, most of the day long." },
      },
    });
    const done = await s.run();
    expect(done).toMatchObject({ status: "FAILED" });
    expect(done?.errorMessage).toContain("không phải tiếng Việt");
  });

  it("asks the brief questions and writes the outline in the project language (ADR 0015)", async () => {
    const s = await setup();
    s.ai.questions = {
      questions: [
        { id: "x", text: "Video cho ai?", kind: "single", options: ["Người nuôi mèo", "Trẻ em"] },
        { id: "y", text: "Một lựa chọn", kind: "multi", options: ["Chỉ một"] },
      ],
    };
    const brief = { idea: "Mèo đi học", targetDurationSec: 30 };
    await s.request({ projectId: "prj_1", task: { type: "brief_questions", input: brief } });
    const asked = await s.run();
    expect(asked?.status).toBe("COMPLETED");
    expect(await s.getResult({ projectId: "prj_1", jobId: asked?.id ?? "" })).toMatchObject({
      type: "brief_questions",
      suggestion: {
        questions: [
          { id: "q1", kind: "single" },
          { id: "q2", kind: "text", options: [] },
        ],
      },
    });

    const answers = [{ question: "Video cho ai?", answer: "Trẻ em" }];
    await s.request({ projectId: "prj_1", task: { type: "script_outline", input: { ...brief, answers } } });
    const written = await s.run();
    expect(written?.status).toBe("COMPLETED");
    expect(s.ai.calls[1]).toMatchObject({ type: "script_outline", input: { answers, language: "vi" } });
    expect(await s.getResult({ projectId: "prj_1", jobId: written?.id ?? "" })).toMatchObject({
      type: "script_outline",
      suggestion: { title: "Mèo", scenes: [{ narration: "Câu một." }, { narration: "Câu hai." }] },
    });
  });

  it("refuses the brief questions when the AI does not write the script", async () => {
    const s = await setup({ settings: { ...MODE_PRESETS.assisted, scriptGeneration: false } });
    await expect(
      s.request({
        projectId: "prj_1",
        task: { type: "brief_questions", input: { idea: "Mèo", targetDurationSec: 30 } },
      }),
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
  });
});
