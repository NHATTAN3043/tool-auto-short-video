import path from "node:path";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import * as schema from "./schema";

export type PgDb = NodePgDatabase<typeof schema>;

export interface PgDatabase {
  db: PgDb;
  /** Ends every pooled connection; call once when the process shuts down. */
  close: () => Promise<void>;
}

/** One connection pool per process, shared by the project, job and sound effect adapters. */
export function createPgDatabase(url: string): PgDatabase {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // An idle client losing its connection (database restart) must not crash the process.
  pool.on("error", (error) => {
    console.error("[postgres] idle client error:", error.message);
  });
  return { db: drizzle({ client: pool, schema }), close: () => pool.end() };
}

/** Creates or upgrades the tables to the latest migration. Safe to run again. */
export async function migrateDatabase(url: string): Promise<void> {
  const database = createPgDatabase(url);
  try {
    // Resolved here, not at module load: the web app imports this file through Next's bundler, where
    // import.meta.dirname is not a real folder. Only the CLI and tests run migrations.
    await migrate(database.db, { migrationsFolder: path.join(import.meta.dirname, "migrations") });
  } finally {
    await database.close();
  }
}

/** True when `error` is Postgres' unique_violation (duplicate primary key). */
export function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error && "cause" in error ? error.cause : error;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505";
}
