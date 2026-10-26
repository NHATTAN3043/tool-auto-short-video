import { describe, expect, it, vi } from "vitest";

import { OpenAi } from "./openai-ai";

function response(data: unknown, extra: Record<string, unknown> = {}): Response {
  return Response.json({
    id: "resp_1",
    object: "response",
    created_at: 1,
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: 4000,
    model: "gpt-6-luna",
    output: [
      {
        id: "msg_1",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify(data), annotations: [], logprobs: [] }],
      },
    ],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: true,
    temperature: 1,
    text: { format: { type: "json_schema" } },
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    usage: {
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 2000,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 3000,
    },
    metadata: {},
    ...extra,
  });
}

describe("OpenAi", () => {
  it("uses Responses structured output and reports usage cost", async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(response({ title: "Mèo", script: "Một." })));
    const ai = new OpenAi({ apiKey: "sk-test", model: "gpt-6-luna", fetch: fetchFn });
    await expect(ai.generateScript({ idea: "Mèo đi học", targetDurationSec: 30 })).resolves.toEqual({
      data: { title: "Mèo", script: "Một." },
      usage: { inputTokens: 1000, outputTokens: 2000, usd: 0.0011 },
    });
    const body = JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "gpt-6-luna", max_output_tokens: 4000 });
    expect(body.text).toMatchObject({ format: { type: "json_schema", strict: true } });
    expect(new Headers(fetchFn.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer sk-test");
  });

  it("sends base64 frames as image inputs", async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        response({
          shots: [
            { shotNumber: 1, description: "Mèo", tagsEn: ["cat"], tagsVi: ["mèo"], textOverlay: false },
          ],
        }),
      ),
    );
    const ai = new OpenAi({ apiKey: "sk-test", fetch: fetchFn });
    const result = await ai.describeShots(
      { fileName: "cat.mp4", durationMs: 2000, shots: [{ startMs: 0, endMs: 2000 }] },
      [{ type: "base64", mediaType: "image/jpeg", data: "YWJj" }],
    );
    expect(result.data.shots[0]).toMatchObject({ index: 0, tags: ["cat", "mèo"] });
    const body = fetchFn.mock.calls[0]?.[1]?.body;
    expect(typeof body === "string" ? body : "").toContain("data:image/jpeg;base64,YWJj");
  });

  it("retries 429 and surfaces incomplete output", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: { message: "busy", type: "rate_limit_error" } }, { status: 429 }),
      )
      .mockResolvedValueOnce(
        response({}, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
      );
    const sleep = vi.fn(() => Promise.resolve());
    const ai = new OpenAi({ apiKey: "sk-test", fetch: fetchFn, sleep });
    await expect(ai.generateScript({ idea: "Mèo đi học", targetDurationSec: 30 })).rejects.toMatchObject({
      code: "AI_INVALID_OUTPUT",
    });
    expect(sleep).toHaveBeenCalledOnce();
  });
});
