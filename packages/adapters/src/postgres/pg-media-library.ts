import { desc, eq } from "drizzle-orm";

import { DomainError, LibraryMediaSchema, type ClipAnalysis, type LibraryMedia } from "@studio/domain";
import type { MediaLibraryRepository } from "@studio/services";

import { isUniqueViolation, type PgDb } from "./database";
import { mediaLibrary } from "./schema";

function notFound(id: string): DomainError {
  return new DomainError("LIBRARY_MEDIA_NOT_FOUND", `Library media not found: ${id}`);
}

/** The shared media library in `media_library`; files stay in StoragePort under `library/media/`. */
export class PgMediaLibrary implements MediaLibraryRepository {
  constructor(private readonly db: PgDb) {}

  async list(): Promise<LibraryMedia[]> {
    const rows = await this.db
      .select()
      .from(mediaLibrary)
      .orderBy(desc(mediaLibrary.createdAt), desc(mediaLibrary.id));
    return rows.map((row) => LibraryMediaSchema.parse(row.data));
  }

  async get(id: string): Promise<LibraryMedia> {
    const [row] = await this.db.select().from(mediaLibrary).where(eq(mediaLibrary.id, id));
    if (!row) throw notFound(id);
    return LibraryMediaSchema.parse(row.data);
  }

  async findBySourceRef(sourceRef: string): Promise<LibraryMedia | null> {
    const [row] = await this.db.select().from(mediaLibrary).where(eq(mediaLibrary.sourceRef, sourceRef));
    return row ? LibraryMediaSchema.parse(row.data) : null;
  }

  async add(item: LibraryMedia): Promise<LibraryMedia> {
    const parsed = LibraryMediaSchema.parse(item);
    try {
      await this.db.insert(mediaLibrary).values({
        id: parsed.id,
        sourceRef: parsed.sourceRef,
        data: parsed,
        createdAt: new Date(parsed.createdAt),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError("INVALID_OPERATION", `Library media already exists: ${parsed.sourceRef}`);
      }
      throw error;
    }
    return parsed;
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

  async remove(id: string): Promise<void> {
    const deleted = await this.db
      .delete(mediaLibrary)
      .where(eq(mediaLibrary.id, id))
      .returning({ id: mediaLibrary.id });
    if (deleted.length === 0) throw notFound(id);
  }

  private change(id: string, update: (item: LibraryMedia) => LibraryMedia): Promise<LibraryMedia> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(mediaLibrary).where(eq(mediaLibrary.id, id)).for("update");
      if (!row) throw notFound(id);
      const parsed = LibraryMediaSchema.safeParse(update(LibraryMediaSchema.parse(row.data)));
      if (!parsed.success) throw new DomainError("INVALID_INPUT", "Invalid library media");
      await tx.update(mediaLibrary).set({ data: parsed.data }).where(eq(mediaLibrary.id, id));
      return parsed.data;
    });
  }
}
