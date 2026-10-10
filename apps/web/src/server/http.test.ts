import { DomainError, type DomainErrorCode } from "@studio/domain";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { parseJsonBody, toErrorResponse } from "./http";

describe("toErrorResponse", () => {
  it.each<[DomainErrorCode, number]>([
    ["INVALID_INPUT", 400],
    ["INVALID_PROJECT", 400],
    ["PROJECT_NOT_FOUND", 404],
    ["SCENE_NOT_FOUND", 404],
    ["JOB_NOT_FOUND", 404],
    ["ASSET_NOT_FOUND", 422],
    ["INVALID_MEDIA", 422],
    ["INVALID_OPERATION", 409],
    ["PROJECT_BUSY", 409],
    ["UNSUPPORTED_SCHEMA_VERSION", 409],
  ])("maps %s to %i with a Vietnamese message", async (code, status) => {
    const res = toErrorResponse(new DomainError(code, "internal detail"));
    expect(res.status).toBe(status);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe(code);
    expect(body.error.message).not.toContain("internal detail");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("maps validation errors to 400", () => {
    const parsed = z.object({ a: z.string() }).safeParse({});
    expect(toErrorResponse(parsed.error).status).toBe(400);
  });

  it("hides unexpected errors behind a generic 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = toErrorResponse(new Error("ENOENT C:\\secret\\path"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("parseJsonBody", () => {
  const schema = z.object({ name: z.string() });
  const post = (body: string) => new Request("http://x/api", { method: "POST", body });

  it("parses and validates JSON", async () => {
    await expect(parseJsonBody(post('{"name":"A"}'), schema)).resolves.toEqual({ name: "A" });
  });

  it("turns malformed or invalid bodies into validation errors", async () => {
    await expect(parseJsonBody(post("{oops"), schema)).rejects.toBeInstanceOf(z.ZodError);
    await expect(parseJsonBody(post('{"name":1}'), schema)).rejects.toBeInstanceOf(z.ZodError);
  });
});
