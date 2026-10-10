// pnpm db:migrate — creates or upgrades the Postgres tables (ADR 0005). Safe to run again.
import { migrateDatabase } from "@studio/adapters/postgres";
import { findRepoRoot, loadRepoEnv } from "@studio/config";

const url = loadRepoEnv(findRepoRoot(import.meta.dirname)).DATABASE_URL;
if (url === undefined) {
  console.error("DATABASE_URL is not set in .env — nothing to migrate.");
  process.exit(1);
}

try {
  await migrateDatabase(url);
  console.warn("Database is up to date.");
} catch (error) {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
