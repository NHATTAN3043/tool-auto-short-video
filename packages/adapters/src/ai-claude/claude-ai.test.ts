import { describe, expect, it, vi } from "vitest";

import type { MediaRankRequest } from "@studio/domain";

import { ClaudeAi, IMAGE_TOKENS, outputBudget } from "./claude-ai";

type Reply = () => Response;

function message(json: unknown, extra: Record<string, unknown> = {}): Reply {
  return () =>
    Response.json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: typeof json === "string" ? json : JSON.stringify(json) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 2000 },
      ...extra,
    });
}

const status = (code: number) => () =>
  Response.json(
    { type: "error", error: { type: "api_error", message: `status ${String(code)}` } },
    { status: code },
  );

function setup(replies: Reply[], model?: string) {
  const fetchFn = vi.fn<typeof fetch>(() => {
    const next = replies.shift();
    if (!next) throw new Error("unexpected request");
    return Promise.resolve(next());
  });
  const sleep = vi.fn(() => Promise.resolve());
  const ai = new ClaudeAi({ apiKey: "sk-test", fetch: fetchFn, sleep, ...(model && { model }) });
  const bodies = () =>
    fetchFn.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as Record<string, unknown>);
  return { ai, fetchFn, sleep, bodies };
}

const scriptInput = { idea: "Mèo đi học", targetDurationSec: 30 };

const candidate = (
  ref: string,
  extra: Partial<MediaRankRequest["scenes"][number]["candidates"][number]> = {},
) => ({
  key: `pexels:video:${ref}`,
  kind: "video" as const,
  width: 1080,
  height: 1920,
  durationMs: 8000,
  description: `${ref} on the street`,
  thumbnail: { type: "remote" as const, url: `https://images.pexels.com/${ref}.jpg` },
  ...extra,
});

const rankInput = (mode: "text" | "vision"): MediaRankRequest => ({
  mode,
  scenes: [
    {
      sceneId: "scn_a",
      narration: "Mèo dạo phố.",
      intent: "Mèo đi trên vỉa hè",
      candidates: [candidate("1"), candidate("2")],
    },
    { sceneId: "scn_b", narration: "Chó ngủ.", candidates: [candidate("3")] },
  ],
});

describe("ClaudeAi", () => {
  it("asks for structured output with low effort and returns the parsed script with its cost", async () => {
    const s = setup([message({ title: "Mèo", script: "Một.\n\nHai." })]);
    const result = await s.ai.generateScript(scriptInput);
    expect(result).toEqual({
      data: { title: "Mèo", script: "Một.\n\nHai." },
      // Sonnet 5.5: $2 / $10 per million tokens.
      usage: { inputTokens: 1000, outputTokens: 2000, usd: 0.022 },
    });
    const [body] = s.bodies();
    expect(body).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    expect(JSON.stringify(body?.messages)).toContain("Mèo đi học");
    expect(new Headers(s.fetchFn.mock.calls[0]?.[1]?.headers).get("x-api-key")).toBe("sk-test");
  });

  it("does not send effort to Haiku and prices it accordingly", async () => {
    const s = setup([message({ title: "", script: "Một." })], "claude-haiku-4-5");
    const result = await s.ai.generateScript(scriptInput);
    expect(s.bodies()[0]?.output_config).not.toHaveProperty("effort");
    expect(result.usage.usd).toBeCloseTo(0.011, 9);
  });

  it("maps scene plans and visual plans into the domain shape", async () => {
    const fields = {
      intent: "Mèo",
      preferredMedia: "video",
      searchQueries: ["cat"],
      searchQueriesVi: ["mèo"],
      searchQueriesZh: ["猫"],
    };
    const plan = {
      intent: "Mèo",
      preferredMedia: "video",
      searchQueries: ["cat"],
      localizedQueries: { vi: ["mèo"], zh: ["猫"] },
    };
    const s = setup([
      message({ scenes: [{ narration: "Một.", ...fields }] }),
      message({
        plans: [
          { sceneNumber: 2, ...fields },
          { sceneNumber: 9, ...fields },
        ],
      }),
    ]);
    expect((await s.ai.planScenes({ script: "Một.", maxWordsPerScene: 18 })).data).toEqual({
      scenes: [{ narration: "Một.", visualPlan: plan }],
    });
    const visual = await s.ai.generateVisualPlans({
      script: "",
      scenes: [
        { id: "scn_a", narration: "A" },
        { id: "scn_b", narration: "B" },
      ],
    });
    expect(visual.data).toEqual({ plans: [{ sceneId: "scn_b", visualPlan: plan }] });
  });

  it("retries 429 and 5xx at most twice, never other errors", async () => {
    const ok = setup([status(429), status(529), message({ title: "", script: "x" })]);
    await ok.ai.generateScript(scriptInput);
    expect(ok.sleep.mock.calls).toEqual([[1000], [2000]]);

    const failing = setup([status(500), status(503), status(502), message({ title: "", script: "x" })]);
    await expect(failing.ai.generateScript(scriptInput)).rejects.toMatchObject({ code: "AI_FAILED" });
    expect(failing.fetchFn).toHaveBeenCalledTimes(3);

    const bad = setup([status(401)]);
    await expect(bad.ai.generateScript(scriptInput)).rejects.toMatchObject({
      code: "AI_FAILED",
      message: expect.stringContaining("API key") as unknown,
    });
    expect(bad.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reports refusals and truncated or malformed output with the billed usage", async () => {
    const refused = setup([message("", { stop_reason: "refusal" })]);
    await expect(refused.ai.generateScript(scriptInput)).rejects.toMatchObject({
      code: "AI_REFUSED",
      usage: { usd: 0.022 },
    });
    const cut = setup([message('{"title":', { stop_reason: "max_tokens" })]);
    await expect(cut.ai.generateScript(scriptInput)).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    const wrong = setup([message({ nope: true })]);
    await expect(wrong.ai.generateScript(scriptInput)).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
  });

  it("estimates with count_tokens, and falls back to a heuristic when counting fails", async () => {
    const s = setup([() => Response.json({ input_tokens: 600 })]);
    const estimate = await s.ai.estimate({ type: "script", input: scriptInput });
    expect(s.fetchFn.mock.calls[0]?.[0]).toContain("/v1/messages/count_tokens");
    // 600 counted + 400 for the output schema; 4000 max output tokens.
    expect(estimate).toMatchObject({ inputTokens: 1000, maxOutputTokens: 4000 });
    expect(estimate.maxUsd).toBeCloseTo((1000 * 2 + 4000 * 10) / 1e6, 9);
    expect(estimate.expectedUsd).toBeLessThan(estimate.maxUsd);

    const offline = setup([status(400)]);
    const fallback = await offline.ai.estimate({ type: "script", input: scriptInput });
    expect(fallback.inputTokens).toBeGreaterThan(400);
  });

  it("ranks by text: candidates described, numbers mapped back to keys", async () => {
    const s = setup([
      message({
        scenes: [
          { sceneNumber: 1, ranking: [2, 9, 1] },
          { sceneNumber: 7, ranking: [1] },
        ],
      }),
    ]);
    const result = await s.ai.rankMedia(rankInput("text"), new Map());
    expect(result.data).toEqual({
      scenes: [{ sceneId: "scn_a", keys: ["pexels:video:2", "pexels:video:1"] }],
    });
    const content = JSON.stringify(s.bodies()[0]?.messages);
    expect(content).toContain("Ứng viên 2: video dọc 1080×1920 · 8 giây · mô tả: 2 on the street");
    expect(content).toContain("Ý đồ hình ảnh: Mèo đi trên vỉa hè");
    expect(content).not.toContain('"type":"image"');
  });

  it("ranks by vision: each candidate line is followed by its thumbnail", async () => {
    const s = setup([message({ scenes: [{ sceneNumber: 1, ranking: [1, 2] }] })]);
    await s.ai.rankMedia(
      rankInput("vision"),
      new Map([
        ["pexels:video:1", { type: "url" as const, url: "https://images.pexels.com/1.jpg" }],
        ["pexels:video:3", { type: "base64" as const, mediaType: "image/jpeg" as const, data: "AAAA" }],
      ]),
    );
    const [body] = s.bodies();
    const blocks = (body?.messages as { content: { type: string; source?: unknown; text?: string }[] }[])[0]
      ?.content;
    expect(blocks?.map((block) => block.type)).toEqual([
      "text", // intro
      "text", // scene 1
      "text",
      "image",
      "text", // candidate 2 has no image
      "text", // scene 2
      "text",
      "image",
    ]);
    expect(blocks?.[3]?.source).toEqual({ type: "url", url: "https://images.pexels.com/1.jpg" });
    expect(blocks?.[7]?.source).toEqual({ type: "base64", media_type: "image/jpeg", data: "AAAA" });
  });

  it("counts image tokens in a vision estimate", async () => {
    const text = setup([() => Response.json({ input_tokens: 600 })]);
    const vision = setup([() => Response.json({ input_tokens: 600 })]);
    const a = await text.ai.estimate({ type: "rank_media", input: rankInput("text") });
    const b = await vision.ai.estimate({ type: "rank_media", input: rankInput("vision") });
    expect(b.inputTokens - a.inputTokens).toBe(3 * IMAGE_TOKENS.max);
    expect(b.maxUsd).toBeGreaterThan(a.maxUsd);
    expect(b.expectedUsd).toBeLessThan(b.maxUsd);
  });

  it("rewrites one scene with the instruction and the script as context", async () => {
    const s = setup([message({ narration: "Mèo đi học sớm." })]);
    const result = await s.ai.rewriteScene({
      script: "Toàn bộ script.",
      narration: "Mèo đi học.",
      instruction: "ngắn hơn",
    });
    expect(result.data).toEqual({ narration: "Mèo đi học sớm." });
    const content = JSON.stringify(s.bodies()[0]?.messages);
    expect(content).toContain("Yêu cầu thêm: ngắn hơn.");
    expect(content).toContain("Toàn bộ script.");
  });

  it("sends a skill as reference notes followed by the Vietnamese rules, in calls and estimates", async () => {
    const guidance = {
      id: "viral-hooks",
      name: "viral-hooks",
      description: "Hooks",
      language: "en" as const,
      content: "Open with a pattern interrupt. Example: Stop scrolling!",
    };
    const s = setup([
      message({ title: "Mèo", script: "Một.\n\nHai." }),
      () => Response.json({ input_tokens: 900 }),
    ]);
    await s.ai.generateScript({ ...scriptInput, skillId: "viral-hooks" }, guidance);
    await s.ai.estimate({ type: "script", input: { ...scriptInput, skillId: "viral-hooks" } }, guidance);
    for (const body of s.bodies()) {
      const system = String(body.system);
      expect(system).toContain(guidance.content);
      // The rules come after the notes, so the model reads them last.
      expect(system.indexOf("QUY TẮC BẮT BUỘC")).toBeGreaterThan(system.indexOf(guidance.content));
      expect(JSON.stringify(body.messages)).toContain(
        "Nhắc lại: mọi lời đọc phải viết hoàn toàn bằng tiếng Việt.",
      );
    }
  });

  it("keeps the plain system prompt without a skill", async () => {
    const s = setup([message({ title: "Mèo", script: "Một.\n\nHai." })]);
    await s.ai.generateScript(scriptInput);
    expect(String(s.bodies()[0]?.system)).not.toContain("<skill>");
    expect(JSON.stringify(s.bodies()[0]?.messages)).not.toContain("Nhắc lại");
  });

  it("asks for English narration in an English project, with the reminder even without a skill", async () => {
    const s = setup([message({ title: "Cats", script: "One.\n\nTwo." })]);
    await s.ai.generateScript({ ...scriptInput, language: "en" });
    const system = String(s.bodies()[0]?.system);
    expect(system).toContain("khán giả nói tiếng Anh");
    expect(system).not.toContain("khán giả Việt Nam");
    expect(JSON.stringify(s.bodies()[0]?.messages)).toContain(
      "Nhắc lại: mọi lời đọc phải viết hoàn toàn bằng tiếng Anh.",
    );
  });

  it("sizes max_tokens by the task", () => {
    expect(outputBudget({ type: "script", input: scriptInput }).max).toBe(4000);
    const long = "từ ".repeat(3000);
    expect(
      outputBudget({ type: "scenes", input: { script: long, maxWordsPerScene: 18 } }).max,
    ).toBeGreaterThan(4000);
    expect(
      outputBudget({ type: "visual", input: { script: "", scenes: [{ id: "a", narration: "x" }] } }).max,
    ).toBe(3000);
  });

  it("asks brief questions in Vietnamese, even for an English video, and numbers them", async () => {
    const s = setup([
      message({
        questions: [{ text: "Video cho ai?", kind: "single", options: ["Người nuôi mèo", "Trẻ em"] }],
      }),
    ]);
    const result = await s.ai.generateBriefQuestions({ ...scriptInput, tone: "hài hước", language: "en" });
    expect(result.data).toEqual({
      questions: [{ id: "q1", text: "Video cho ai?", kind: "single", options: ["Người nuôi mèo", "Trẻ em"] }],
    });
    const prompt = JSON.stringify(s.bodies()[0]?.messages);
    expect(prompt).toContain("Mọi câu hỏi và lựa chọn viết bằng tiếng Việt");
    expect(prompt).toContain("Giọng văn đã chọn: hài hước.");
    expect(prompt).not.toContain("Nhắc lại");
  });

  it("writes an outline from the answers, and a revision from the feedback", async () => {
    const scene = {
      narration: "Mèo ngủ mười sáu tiếng.",
      intent: "Mèo ngủ",
      preferredMedia: "video",
      searchQueries: ["cat sleeping"],
      searchQueriesVi: ["mèo ngủ"],
      searchQueriesZh: ["猫睡觉"],
    };
    const s = setup([message({ title: "Mèo", scenes: [scene] }), message({ title: "Mèo", scenes: [scene] })]);
    const answers = [{ question: "Video cho ai?", answer: "Trẻ em" }];
    const result = await s.ai.generateScriptOutline({ ...scriptInput, answers });
    expect(result.data).toEqual({
      title: "Mèo",
      scenes: [
        {
          narration: "Mèo ngủ mười sáu tiếng.",
          visualPlan: {
            intent: "Mèo ngủ",
            preferredMedia: "video",
            searchQueries: ["cat sleeping"],
            localizedQueries: { vi: ["mèo ngủ"], zh: ["猫睡觉"] },
          },
        },
      ],
    });
    expect(JSON.stringify(s.bodies()[0]?.messages)).toContain("Video cho ai? → Trẻ em");

    await s.ai.generateScriptOutline({
      ...scriptInput,
      answers: [],
      revision: { feedback: "hook mạnh hơn", scenes: ["Câu cũ."] },
    });
    const revision = JSON.stringify(s.bodies()[1]?.messages);
    expect(revision).toContain("Người dùng không trả lời thêm câu hỏi nào");
    expect(revision).toContain("Cảnh 1: Câu cũ.");
    expect(revision).toContain("Góp ý của người dùng: hook mạnh hơn");
  });

  it("sizes the outline like a script with its scene plan", () => {
    expect(outputBudget({ type: "brief_questions", input: scriptInput }).max).toBe(3000);
    expect(outputBudget({ type: "script_outline", input: { ...scriptInput, answers: [] } }).max).toBe(6000);
    expect(
      outputBudget({ type: "script_outline", input: { ...scriptInput, targetDurationSec: 180, answers: [] } })
        .max,
    ).toBeGreaterThan(6000);
  });
});
