import { describe, expect, it } from "vitest";

import { matchesModelPatterns } from "./provider-models";

describe("AI model allowlist patterns", () => {
  it("supports comma-separated literal globs", () => {
    expect(matchesModelPatterns("gpt-safe-2", "gpt-safe-*,claude-sonnet")).toBe(true);
    expect(matchesModelPatterns("claude-sonnet", "gpt-safe-*,claude-sonnet")).toBe(true);
    expect(matchesModelPatterns("text-embedding-3", "gpt-safe-*,claude-sonnet")).toBe(false);
  });

  it("treats regex characters as literals", () => {
    expect(matchesModelPatterns("gpt.test", "gpt.test")).toBe(true);
    expect(matchesModelPatterns("gptXtest", "gpt.test")).toBe(false);
  });
});
