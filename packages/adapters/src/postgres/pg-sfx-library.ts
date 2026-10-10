import { desc, eq } from "drizzle-orm";

import { DomainError, LibrarySfxSchema, type LibrarySfx } from "@studio/domain";
import type { SfxLibraryRepository } from "@studio/services";

import { isUniqueViolation, type PgDb } from "./database";
import { sfxLibrary } from "./schema";

type SfxRow = typeof sfxLibrary.$inferSelect;

function fromRow(row: SfxRow): LibrarySfx {
  return LibrarySfxSchema.parse({
    id: row.id,
    name: row.name,
    fileName: row.fileName,
    path: row.path,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    ...(row.durationMs !== null && { durationMs: row.durationMs }),
  });
}

function notFound(id: string): DomainError {
  return new DomainError("SFX_NOT_FOUND", `Sound effect not found: ${id}`);
}

/** Metadata of the shared sound effect library in `sfx_library` (ADR 0005); files stay in StoragePort. */
export class PgSfxLibrary implements SfxLibraryRepository {
  constructor(private readonly db: PgDb) {}

  async list(): Promise<LibrarySfx[]> {
    const rows = await this.db
      .select()
      .from(sfxLibrary)
      .orderBy(desc(sfxLibrary.createdAt), desc(sfxLibrary.id));
    return rows.map(fromRow);
  }

  async get(id: string): Promise<LibrarySfx> {
    const [row] = await this.db.select().from(sfxLibrary).where(eq(sfxLibrary.id, id));
    if (!row) throw notFound(id);
    return fromRow(row);
  }

  async add(item: LibrarySfx): Promise<LibrarySfx> {
    const parsed = LibrarySfxSchema.parse(item);
    try {
      await this.db.insert(sfxLibrary).values({
        ...parsed,
        durationMs: parsed.durationMs ?? null,
        createdAt: new Date(parsed.createdAt),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError("INVALID_OPERATION", `Sound effect already exists: ${parsed.id}`);
      }
      throw error;
    }
    return parsed;
  }

  async rename(id: string, name: string): Promise<LibrarySfx> {
    const current = await this.get(id);
    const parsed = LibrarySfxSchema.safeParse({ ...current, name });
    if (!parsed.success) throw new DomainError("INVALID_INPUT", "Invalid sound effect name");
    const [row] = await this.db
      .update(sfxLibrary)
      .set({ name: parsed.data.name })
      .where(eq(sfxLibrary.id, id))
      .returning();
    if (!row) throw notFound(id);
    return fromRow(row);
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.db
      .delete(sfxLibrary)
      .where(eq(sfxLibrary.id, id))
      .returning({ id: sfxLibrary.id });
    if (deleted.length === 0) throw notFound(id);
  }
}
