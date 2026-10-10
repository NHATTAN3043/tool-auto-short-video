import { describe, expect, it } from "vitest";

import { SfxLibrarySchema, sfxNameFromFileName } from "./sfx-library";

describe("sfx library", () => {
  it("names an effect after its file", () => {
    expect(sfxNameFromFileName("ting-ting.mp3")).toBe("ting-ting");
    expect(sfxNameFromFileName("no-extension")).toBe("no-extension");
    expect(sfxNameFromFileName(".mp3")).toBe(".mp3");
    expect(sfxNameFromFileName(`${"a".repeat(100)}.wav`)).toHaveLength(80);
  });

  it("validates the stored library", () => {
    const item = {
      id: "lib_1",
      name: "Pop",
      fileName: "pop.mp3",
      path: "files/lib_1.mp3",
      contentHash: "sha256:abc",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(SfxLibrarySchema.parse({ schemaVersion: 1, items: [item] }).items).toHaveLength(1);
    expect(SfxLibrarySchema.safeParse({ schemaVersion: 2, items: [] }).success).toBe(false);
    expect(SfxLibrarySchema.safeParse({ schemaVersion: 1, items: [{ ...item, name: " " }] }).success).toBe(
      false,
    );
  });
});
