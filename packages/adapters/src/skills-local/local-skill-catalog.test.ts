import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SKILL_MAX_CHARS } from "@studio/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalSkillCatalog, parseSkillFile } from "./local-skill-catalog";

const HOOKS = [
  "---",
  "name: viral-hooks",
  'description: "Write and critique viral hooks for short-form video: the opening',
  '  1 to 3 seconds that decide whether anything else gets seen."',
  "license: MIT",
  "metadata:",
  "  author: Vyral",
  "  tags: [hooks, short-form]",
  "---",
  "",
  "# Viral hooks",
  "",
  "Open with a pattern interrupt.",
].join("\r\n");

describe("parseSkillFile", () => {
  it("reads top-level fields, joins continued values and drops the header from the body", () => {
    const { fields, body } = parseSkillFile(HOOKS);
    expect(fields.name).toBe("viral-hooks");
    expect(fields.description).toBe(
      "Write and critique viral hooks for short-form video: the opening 1 to 3 seconds that decide whether anything else gets seen.",
    );
    expect(fields.author).toBeUndefined();
    expect(body).toBe("# Viral hooks\n\nOpen with a pattern interrupt.");
  });

  it("reads folded blocks and files without a header", () => {
    expect(parseSkillFile("---\ndescription: >\n  Một dòng\n  rồi dòng nữa\n---\nNội dung").fields).toEqual({
      description: "Một dòng rồi dòng nữa",
    });
    expect(parseSkillFile("Chỉ có nội dung")).toEqual({ fields: {}, body: "Chỉ có nội dung" });
  });
});

describe("LocalSkillCatalog", () => {
  let dir = "";
  const write = (id: string, file: string, text: string) => {
    mkdirSync(path.join(dir, id), { recursive: true });
    writeFileSync(path.join(dir, id, file), text);
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-skills-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists usable skills by name and skips broken, oversized or oddly named folders", async () => {
    write("viral-hooks", "SKILL.md", HOOKS);
    write("b-skill", "SKILL.md", "---\nname: a skill\n---\nBody");
    write("empty", "SKILL.md", "---\nname: empty\n---\n");
    write("huge", "SKILL.md", "x".repeat(SKILL_MAX_CHARS + 1));
    write("Bad Name", "SKILL.md", "Body");
    write("no-file", "README.md", "Body");
    writeFileSync(path.join(dir, "stray.md"), "Body");

    expect(await new LocalSkillCatalog(dir).list()).toEqual([
      { id: "b-skill", name: "a skill", description: "", language: "en" },
      {
        id: "viral-hooks",
        name: "viral-hooks",
        description: expect.stringContaining("Write and critique") as string,
        language: "en",
      },
    ]);
  });

  it("prefers the Vietnamese copy and returns the body as content", async () => {
    write("viral-hooks", "SKILL.md", HOOKS);
    write("viral-hooks", "SKILL.vi.md", "---\nname: Câu móc viral\n---\nMở đầu bằng một câu gây bất ngờ.");
    expect(await new LocalSkillCatalog(dir).get("viral-hooks")).toEqual({
      id: "viral-hooks",
      name: "Câu móc viral",
      description: "",
      language: "vi",
      content: "Mở đầu bằng một câu gây bất ngờ.",
    });
  });

  it("reads the English copy first for an English project, the Vietnamese one when it is alone", async () => {
    write("viral-hooks", "SKILL.md", HOOKS);
    write("viral-hooks", "SKILL.vi.md", "---\nname: Câu móc viral\n---\nMở đầu bằng một câu gây bất ngờ.");
    write("only-vi", "SKILL.vi.md", "---\nname: Chỉ tiếng Việt\n---\nNội dung.");
    const catalog = new LocalSkillCatalog(dir);
    expect(await catalog.get("viral-hooks", "en")).toMatchObject({ language: "en" });
    expect(await catalog.get("viral-hooks", "vi")).toMatchObject({ language: "vi" });
    expect(await catalog.get("only-vi", "en")).toMatchObject({ language: "vi" });
  });

  it("finds nothing outside the folder, nor in a missing folder", async () => {
    const catalog = new LocalSkillCatalog(dir);
    expect(await catalog.get("../etc")).toBeNull();
    expect(await catalog.get("missing")).toBeNull();
    expect(await new LocalSkillCatalog(path.join(dir, "nope")).list()).toEqual([]);
  });
});
