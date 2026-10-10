import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ApiUsageEntrySchema,
  BudgetSettingsSchema,
  DomainError,
  matchesUsageFilter,
  sumUsageUsd,
  type ApiUsageEntry,
  type BudgetSettings,
  type UsageFilter,
} from "@studio/domain";
import { KeyedLock, type ApiUsageLog, type BudgetSettingsStore } from "@studio/services";

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * `usage/api-usage.jsonl` under the storage root: one JSON line per paid call, appended and never
 * rewritten. Only the worker makes paid calls, so one process appends.
 */
export class JsonApiUsageLog implements ApiUsageLog {
  private readonly file: string;
  private readonly lock = new KeyedLock();

  constructor(rootDir: string) {
    this.file = path.resolve(rootDir, "usage", "api-usage.jsonl");
  }

  append(entry: ApiUsageEntry): Promise<void> {
    return this.lock.run("log", async () => {
      const parsed = ApiUsageEntrySchema.parse(entry);
      await mkdir(path.dirname(this.file), { recursive: true });
      await appendFile(this.file, `${JSON.stringify(parsed)}\n`, "utf8");
    });
  }

  async totalUsd(filter: UsageFilter = {}): Promise<number> {
    return sumUsageUsd(await this.read(), filter);
  }

  async list(filter: UsageFilter = {}): Promise<ApiUsageEntry[]> {
    return (await this.read()).filter((entry) => matchesUsageFilter(entry, filter));
  }

  private async read(): Promise<ApiUsageEntry[]> {
    const text = await readText(this.file);
    if (text === null) return [];
    const lines = text.split("\n");
    const entries: ApiUsageEntry[] = [];
    for (const [index, line] of lines.entries()) {
      if (line.trim() === "") continue;
      const parsed = parseLine(line);
      if (parsed) {
        entries.push(parsed);
        continue;
      }
      // A crash in the middle of an append can only cut the last line; anything else is corruption.
      if (index === lines.length - 1) break;
      throw new DomainError("INVALID_INPUT", `Usage log line ${String(index + 1)} is not a valid entry`);
    }
    return entries;
  }
}

function parseLine(line: string): ApiUsageEntry | null {
  try {
    const parsed = ApiUsageEntrySchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** `settings/budget.json` under the storage root. */
export class JsonBudgetSettings implements BudgetSettingsStore {
  private readonly file: string;
  private readonly lock = new KeyedLock();

  constructor(rootDir: string) {
    this.file = path.resolve(rootDir, "settings", "budget.json");
  }

  async get(): Promise<BudgetSettings | null> {
    const text = await readText(this.file);
    if (text === null) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new DomainError("INVALID_INPUT", "The budget settings file is not valid JSON");
    }
    const parsed = BudgetSettingsSchema.safeParse(raw);
    if (!parsed.success) throw new DomainError("INVALID_INPUT", "The budget settings file is not valid");
    return parsed.data;
  }

  save(settings: BudgetSettings): Promise<BudgetSettings> {
    return this.lock.run("settings", async () => {
      const parsed = BudgetSettingsSchema.parse(settings);
      // Write-then-rename so a crash mid-write never leaves a corrupt file.
      await mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
        await rename(temp, this.file);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      return parsed;
    });
  }
}
