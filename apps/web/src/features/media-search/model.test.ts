import { describe, expect, it } from "vitest";

import {
  formatDuration,
  initialSearch,
  keywordGroups,
  linkUrl,
  narrationKeywordGroup,
  orientationLabel,
  parseTags,
  queryForLanguage,
} from "./model";

const plan = {
  intent: "Mèo",
  preferredMedia: "video" as const,
  searchQueries: ["cat playing"],
  localizedQueries: { vi: ["mèo con"], zh: [] },
};

describe("media search model", () => {
  it("loads stock files through the proxy and library files from the library route", () => {
    expect(linkUrl({ type: "remote", url: "https://cdn.pixabay.com/a b.mp4" })).toBe(
      "/api/media-proxy?url=https%3A%2F%2Fcdn.pixabay.com%2Fa%20b.mp4",
    );
    expect(linkUrl({ type: "library", id: "lib_1", file: "thumbnail" })).toBe(
      "/api/media-library/lib_1/file?file=thumbnail",
    );
  });

  it("groups keywords per language and prefills with the first one", () => {
    expect(keywordGroups(plan)).toEqual([
      { lang: "en", queries: ["cat playing"] },
      { lang: "vi", queries: ["mèo con"] },
    ]);
    expect(keywordGroups(undefined)).toEqual([]);
    expect(initialSearch(plan)).toEqual({ query: "cat playing", lang: "en" });
    expect(initialSearch({ ...plan, searchQueries: [] })).toEqual({ query: "mèo con", lang: "vi" });
    expect(initialSearch(undefined)).toEqual({ query: "", lang: "en" });
    const fromNarration = narrationKeywordGroup("Mèo con chơi đùa trong vườn.", "vi");
    expect(fromNarration).toMatchObject({ lang: "vi", label: "Từ lời đọc" });
    expect(initialSearch(undefined, fromNarration)).toEqual({ query: "mèo con chơi", lang: "vi" });
    expect(initialSearch(plan, fromNarration)).toEqual({ query: "cat playing", lang: "en" });
    expect(narrationKeywordGroup("   ", "vi")).toBeNull();
  });

  it("switches the query to the scene's keyword in the chosen language, if it has one", () => {
    expect(queryForLanguage(plan, "vi", "cat playing")).toBe("mèo con");
    expect(queryForLanguage(plan, "en", "mèo con")).toBe("cat playing");
    expect(queryForLanguage(plan, "zh", "cat playing")).toBe("cat playing");
    expect(queryForLanguage(undefined, "vi", "typed")).toBe("typed");
  });

  it("formats durations, orientation and tags", () => {
    expect(formatDuration(8400)).toBe("0:08");
    expect(formatDuration(75_000)).toBe("1:15");
    expect(orientationLabel(1080, 1920)).toBe("Dọc");
    expect(orientationLabel(1920, 1080)).toBe("Ngang");
    expect(parseTags(" mèo, , 小猫 ")).toEqual(["mèo", "小猫"]);
  });
});
