import { randomBytes } from "node:crypto";

import { loadRepoEnv } from "@studio/config";
import pg from "pg";

import { createPgDatabase, migrateDatabase, type PgDatabase } from "./database";

// Tests only. Each test file gets its own throwaway database on the TEST_DATABASE_URL server, migrated to the
// latest schema, so files can run in parallel. Without TEST_DATABASE_URL the Postgres tests are skipped.

export const TEST_DATABASE_URL = loadRepoEnv().TEST_DATABASE_URL;

export interface TestDatabase {
  url: string;
  /** Opens another pool on the same database (to test two processes writing at once). */
  connect(): PgDatabase;
  /** Closes every pool opened through `connect` and drops the database. */
  drop(): Promise<void>;
}

async function admin(serverUrl: string, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

export async function createTestDatabase(serverUrl: string): Promise<TestDatabase> {
  const name = `studio_test_${randomBytes(6).toString("hex")}`;
  await admin(serverUrl, `CREATE DATABASE "${name}"`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  await migrateDatabase(url.href);
  const opened: PgDatabase[] = [];
  return {
    url: url.href,
    connect() {
      const database = createPgDatabase(url.href);
      opened.push(database);
      return database;
    },
    async drop() {
      await Promise.all(opened.map((database) => database.close()));
      await admin(serverUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}

/** Empties every table between tests; cascades from projects to their jobs. */
export async function truncateAll(database: PgDatabase): Promise<void> {
  await database.db.execute(
    "TRUNCATE projects, render_jobs, sfx_library, media_library, api_usage, budget_settings CASCADE",
  );
}
