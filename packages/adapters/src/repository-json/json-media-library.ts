import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DomainError,
  LibraryMediaSchema,
  MEDIA_LIBRARY_SCHEMA_VERSION,
  MediaLibrarySchema,
  type ClipAnalysis,
  type LibraryMedia,
  type MediaLibrary,
} from "@studio/domain";
import { KeyedLock, MEDIA_LIBRARY_ROOT, type MediaLibraryRepository } from "@studio/services";

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function notFound(id: string): DomainError {
  return new DomainError("LIBRARY_MEDIA_NOT_FOUND", `Library media not found: ${id}`);
}

/** `library/media/index.json` under the storage root; the files sit next to it. */
export class JsonMediaLibrary implements MediaLibraryRepository {
  private readonly file: string;
  private readonly lock = new KeyedLock();

  constructor(rootDir: string) {
    this.file = path.resolve(rootDir, ...MEDIA_LIBRARY_ROOT.split("/"), "index.json");
  }

  async list(): Promise<LibraryMedia[]> {
    const { items } = await this.read();
    return [...items].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<LibraryMedia> {
    const item = (await this.read()).items.find((candidate) => candidate.id === id);
    if (!item) throw notFound(id);
    return item;
  }

  async findBySourceRef(sourceRef: string): Promise<LibraryMedia | null> {
    return (await this.read()).items.find((item) => item.sourceRef === sourceRef) ?? null;
  }

  add(item: LibraryMedia): Promise<LibraryMedia> {
    return this.mutate((library) => {
      const parsed = LibraryMediaSchema.parse(item);
      if (
        library.items.some((existing) => existing.id === parsed.id || existing.sourceRef === parsed.sourceRef)
      ) {
        throw new DomainError("INVALID_OPERATION", `Library media already exists: ${parsed.sourceRef}`);
      }
      return { library: { ...library, items: [...library.items, parsed] }, result: parsed };
    });
  }

  setTags(id: string, tags: readonly string[]): Promise<LibraryMedia> {
    return this.change(id, (item) => ({ ...item, tags: [...tags] }));
  }

  setAnalysis(id: string, analysis: ClipAnalysis): Promise<LibraryMedia> {
    return this.change(id, (item) => ({ ...item, analysis }));
  }

  incrementUsage(id: string): Promise<LibraryMedia> {
    return this.change(id, (item) => ({ ...item, usageCount: item.usageCount + 1 }));
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

  private change(id: string, update: (item: LibraryMedia) => LibraryMedia): Promise<LibraryMedia> {
    return this.mutate((library) => {
      const current = library.items.find((item) => item.id === id);
      if (!current) throw notFound(id);
      const parsed = LibraryMediaSchema.safeParse(update(current));
      if (!parsed.success) throw new DomainError("INVALID_INPUT", "Invalid library media");
      const items = library.items.map((item) => (item.id === id ? parsed.data : item));
      return { library: { ...library, items }, result: parsed.data };
    });
  }

  private async read(): Promise<MediaLibrary> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if (isNotFound(error)) return { schemaVersion: MEDIA_LIBRARY_SCHEMA_VERSION, items: [] };
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new DomainError("INVALID_INPUT", "The media library index is not valid JSON");
    }
    const parsed = MediaLibrarySchema.safeParse(raw);
    if (!parsed.success) {
      throw new DomainError("INVALID_INPUT", parsed.error.issues.map((issue) => issue.message).join("; "));
    }
    return parsed.data;
  }

  private mutate<T>(change: (library: MediaLibrary) => { library: MediaLibrary; result: T }): Promise<T> {
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
