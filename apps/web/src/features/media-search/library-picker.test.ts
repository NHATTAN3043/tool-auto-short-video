import type { LibraryMedia } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { filterLibraryMedia } from "./library-picker";

const item = (
  id: string,
  fileName: string,
  kind: LibraryMedia["kind"],
  tags: string[] = [],
): LibraryMedia => ({
  id,
  fileName,
  kind,
  tags,
  path: `files/${fileName}`,
  source: "upload",
  sourceRef: `upload:sha256:${id}`,
  contentHash: `sha256:${id}`,
  usageCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const items = [item("a", "Cầu bê tông.mp4", "video"), item("b", "photo.jpg", "image", ["Mèo con"])];

describe("manual library browsing", () => {
  it("offers every file without narration, tags, or analysis, preserving library order", () => {
    expect(filterLibraryMedia(items, "   ", "all")).toEqual(items);
  });

  it("filters filenames and tags without case or Vietnamese accent sensitivity", () => {
    expect(filterLibraryMedia(items, " CAU BE TONG ", "all")).toEqual([items[0]]);
    expect(filterLibraryMedia(items, "meo con", "all")).toEqual([items[1]]);
  });

  it("combines type and text filters without mutating the library", () => {
    expect(filterLibraryMedia(items, "", "video")).toEqual([items[0]]);
    expect(filterLibraryMedia(items, "", "image")).toEqual([items[1]]);
    expect(filterLibraryMedia(items, "meo", "video")).toEqual([]);
    expect(filterLibraryMedia(items, "missing", "all")).toEqual([]);
    expect(filterLibraryMedia([], "", "all")).toEqual([]);
    expect(items).toHaveLength(2);
  });
});
