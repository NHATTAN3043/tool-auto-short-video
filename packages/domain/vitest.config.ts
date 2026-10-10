import { defineConfig } from "vitest/config";

// Coverage is configured here and run with `--root packages/domain` because the root multi-project
// run collects no files for v8 coverage. Gate from PLAN M1: domain ≥ 90%.
export default defineConfig({
  test: {
    name: "@studio/domain",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/testing/**", "src/**/types.ts"],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
