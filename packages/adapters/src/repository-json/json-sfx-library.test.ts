import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LibrarySfx } from "@studio/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonSfxLibrary } from "./json-sfx-library";

const item = (id: string, createdAt = "2026-01-01T00:00:00.000Z"): LibrarySfx => ({
  id,
  name: `Hiệu ứng ${id}`,
  fileName: `${id}.mp3`,
  path: `files/${id}.mp3`,
  durationMs: 800,
  contentHash: `sha256:${id}`,
  createdAt,
});

describe("JsonSfxLibrary", () => {
  let root = "";
  let library: JsonSfxLibrary;
  const indexFile = () => path.join(root, "library", "sfx", "index.json");

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "studio-sfx-"));
    library = new JsonSfxLibrary(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("starts empty and persists added items, newest first", async () => {
    expect(await library.list()).toEqual([]);
    await library.add(item("lib_1"));
    await library.add(item("lib_2", "2026-02-01T00:00:00.000Z"));
    expect((await new JsonSfxLibrary(root).list()).map((sfx) => sfx.id)).toEqual(["lib_2", "lib_1"]);
    expect(JSON.parse(readFileSync(indexFile(), "utf8"))).toMatchObject({ schemaVersion: 1 });
  });

  it("keeps concurrent adds", async () => {
    await Promise.all(["lib_1", "lib_2", "lib_3"].map((id) => library.add(item(id))));
    expect(await library.list()).toHaveLength(3);
  });

  it("renames and removes, reporting unknown ids", async () => {
    await library.add(item("lib_1"));
    expect((await library.rename("lib_1", "Bốp")).name).toBe("Bốp");
    await expect(library.rename("lib_1", "  ")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await library.remove("lib_1");
    await expect(library.get("lib_1")).rejects.toMatchObject({ code: "SFX_NOT_FOUND" });
    await expect(library.remove("lib_1")).rejects.toMatchObject({ code: "SFX_NOT_FOUND" });
  });

  it("rejects a corrupt index instead of overwriting it", async () => {
    mkdirSync(path.dirname(indexFile()), { recursive: true });
    writeFileSync(indexFile(), "{oops");
    await expect(library.list()).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(library.add(item("lib_1"))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(readFileSync(indexFile(), "utf8")).toBe("{oops");
  });
});
