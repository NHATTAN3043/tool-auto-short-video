import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  SKILL_MAX_CHARS,
  SkillGuidanceSchema,
  SkillIdSchema,
  type ContentLanguage,
  type SkillGuidance,
  type SkillLanguage,
  type SkillSummary,
} from "@studio/domain";
import type { SkillCatalogPort } from "@studio/services";
import { z } from "zod";

// Skills installed as folders (`<dir>/<id>/SKILL.md`), the layout Claude Code and `npx skills` use.
// Only SKILL.md is read: references/ and assets/ are far too long to send with every call (ADR 0012).

/**
 * The Vietnamese copy wins when present: English notes can pull the model into writing English. An English
 * project reads SKILL.md first, for the same reason the other way round (ADR 0013).
 */
const FILES: readonly { name: string; language: SkillLanguage }[] = [
  { name: "SKILL.vi.md", language: "vi" },
  { name: "SKILL.md", language: "en" },
];

const FrontmatterSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
});

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0]) {
    return trimmed.slice(1, -1).replace(/\\"/gu, '"');
  }
  return trimmed;
}

/**
 * The `---` header and the body. Only top-level `key: value` pairs are read, a value may continue on
 * indented lines (quoted strings, `>` and `|` blocks) and is joined into one line; nested maps are skipped.
 */
export function parseSkillFile(text: string): { fields: Record<string, string>; body: string } {
  const normalized = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/u.exec(normalized);
  if (!match) return { fields: {}, body: normalized.trim() };
  const fields: Record<string, string> = {};
  let key: string | null = null;
  let parts: string[] = [];
  const flush = () => {
    if (key !== null)
      fields[key] = unquote(
        parts
          .join(" ")
          .replace(/\s+/gu, " ")
          .replace(/^[>|][-+]?\s*/u, ""),
      );
  };
  for (const line of (match[1] ?? "").split("\n")) {
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/u.exec(line);
    if (top) {
      flush();
      key = top[1] ?? null;
      parts = [top[2] ?? ""];
    } else if (key !== null && /^\s+\S/u.test(line)) {
      parts.push(line.trim());
    }
  }
  flush();
  return { fields, body: normalized.slice(match[0].length).trim() };
}

/** Reads skills from a folder on every call, so installing or editing one needs no restart. */
export class LocalSkillCatalog implements SkillCatalogPort {
  constructor(private readonly dir: string) {}

  async list(): Promise<SkillSummary[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const skills = await Promise.all(
      entries.filter((entry) => SkillIdSchema.safeParse(entry).success).map((id) => this.get(id)),
    );
    return skills
      .flatMap((skill) =>
        skill
          ? [{ id: skill.id, name: skill.name, description: skill.description, language: skill.language }]
          : [],
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string, language?: ContentLanguage): Promise<SkillGuidance | null> {
    // The id is a folder name by schema, so it cannot climb out of `dir`.
    if (!SkillIdSchema.safeParse(id).success) return null;
    const files = language === "en" ? [...FILES].reverse() : FILES;
    for (const file of files) {
      let text: string;
      try {
        text = await readFile(path.join(this.dir, id, file.name), "utf8");
      } catch (error) {
        if (isNotFound(error)) continue;
        throw error;
      }
      return this.toGuidance(id, file.language, text);
    }
    return null;
  }

  private toGuidance(id: string, language: SkillLanguage, text: string): SkillGuidance | null {
    const { fields, body } = parseSkillFile(text);
    if (body.length > SKILL_MAX_CHARS) return null;
    const header = FrontmatterSchema.safeParse(fields);
    const parsed = SkillGuidanceSchema.safeParse({
      id,
      name: (header.success ? header.data.name : undefined) ?? id,
      description: (header.success ? header.data.description : undefined) ?? "",
      language,
      content: body,
    });
    return parsed.success ? parsed.data : null;
  }
}
