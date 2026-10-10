import { defineConfig } from "drizzle-kit";

// Only used by `pnpm db:generate` to turn schema.ts into SQL migrations; no database connection needed.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/postgres/schema.ts",
  out: "./src/postgres/migrations",
});
