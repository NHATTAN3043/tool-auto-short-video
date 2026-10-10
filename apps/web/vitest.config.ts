import path from "node:path";

import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "test/server-only-stub.ts"),
    },
  },
  test: {
    name: "@studio/web",
    // The API tests build the real container from the repo .env. An empty DATABASE_URL (which .env never
    // overrides) keeps them on JSON files in their temp folder instead of the developer's real database.
    env: { DATABASE_URL: "" },
  },
});
