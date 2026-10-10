import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DomainError,
  LibrarySfxSchema,
  SFX_LIBRARY_SCHEMA_VERSION,
  SfxLibrarySchema,
  type LibrarySfx,
  type SfxLibrary,
} from "@studio/domain";
import { KeyedLock, SFX_LIBRARY_ROOT, type SfxLibraryRepository } from "@studio/services";

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function notFound(id: string): DomainError {
  return new DomainError("SFX_NOT_FOUND", `Sound effect not found: ${id}`);
}

/** `library/sfx/index.json` under the storage root; the effect files sit next to it. */
export class JsonSfxLibrary implements SfxLibraryRepository {
  private readonly file: string;
  private readonly lock = new KeyedLock();

  constructor(rootDir: string) {
    this.file = path.resolve(rootDir, ...SFX_LIBRARY_ROOT.split("/"), "index.json");
  }

  async list(): Promise<LibrarySfx[]> {
    const { items } = await this.read();
    return [...items].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<LibrarySfx> {
    const item = (await this.read()).items.find((candidate) => candidate.id === id);
    if (!item) throw notFound(id);
    return item;
  }

  add(item: LibrarySfx): Promise<LibrarySfx> {
    return this.mutate((library) => {
      const parsed = LibrarySfxSchema.parse(item);
      if (library.items.some((existing) => existing.id === parsed.id)) {
        throw new DomainError("INVALID_OPERATION", `Sound effect already exists: ${parsed.id}`);
      }
      return { library: { ...library, items: [...library.items, parsed] }, result: parsed };
    });
  }

  rename(id: string, name: string): Promise<LibrarySfx> {
    return this.mutate((library) => {
      const current = library.items.find((item) => item.id === id);
      if (!current) throw notFound(id);
      const parsed = LibrarySfxSchema.safeParse({ ...current, name });
      if (!parsed.success) throw new DomainError("INVALID_INPUT", "Invalid sound effect name");
      const items = library.items.map((item) => (item.id === id ? parsed.data : item));
      return { library: { ...library, items }, result: parsed.data };
    });
  }

  remove(id: string): Promise<void> {
    return this.mutate((library) => {
      if (!library.items.some((item) => item.id === id)) throw notFound(id);
      return {
        library: { ...library, items: library.items.filter((item) => item.id !== id) },
        result: undefined,
      };
    });
  }

  private async read(): Promise<SfxLibrary> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if (isNotFound(error)) return { schemaVersion: SFX_LIBRARY_SCHEMA_VERSION, items: [] };
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new DomainError("INVALID_INPUT", "The sound effect library index is not valid JSON");
    }
    const parsed = SfxLibrarySchema.safeParse(raw);
    if (!parsed.success) {
      throw new DomainError("INVALID_INPUT", parsed.error.issues.map((issue) => issue.message).join("; "));
    }
    return parsed.data;
  }

  private mutate<T>(change: (library: SfxLibrary) => { library: SfxLibrary; result: T }): Promise<T> {
    return this.lock.run("library", async () => {
      const { library, result } = change(await this.read());
      // Write-then-rename so a crash mid-write never leaves a corrupt index.
      await mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, `${JSON.stringify(library, null, 2)}\n`, "utf8");
        await rename(temp, this.file);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      return result;
    });
  }
}
