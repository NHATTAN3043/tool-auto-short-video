import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnv } from "@studio/config";
import { describe, expect, it } from "vitest";

import { createContainer, REPO_ROOT } from "./container";
import { timestampName } from "./cli/progress";

describe("worker container", () => {
  it("wires adapters onto the configured storage folder", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "studio-worker-"));
    try {
      const container = createContainer(loadEnv({ STUDIO_STORAGE_DIR: dir }));
      expect(container.storageDir).toBe(path.resolve(dir));
      expect(await container.repo.list()).toEqual([]);
      expect(await container.runNextRenderJob()).toBeNull();
      expect(await container.failStaleJobs()).toBe(0);
      // CostGuard reads the (still empty) usage log and the budget defaults of the environment.
      expect(await container.costGuard.check({ totalUsd: 0.1, maxCallUsd: 0.1 })).toMatchObject({
        allowed: true,
        limits: { perCallUsd: 0.5, perDayUsd: 2, perMonthUsd: 20, perProjectUsd: 1 },
        spent: { dayUsd: 0, monthUsd: 0, projectUsd: null },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads jobs from Postgres when DATABASE_URL is set, without connecting until first use", async () => {
    const container = createContainer(loadEnv({ DATABASE_URL: "postgres://user:pass@localhost:1/none" }));
    expect(container.jobSource).toBe("postgres");
    await container.close();
  });

  it("resolves a relative storage folder against the repo root", () => {
    const container = createContainer(loadEnv({ STUDIO_STORAGE_DIR: "./storage" }));
    expect(container.storageDir).toBe(path.join(REPO_ROOT, "storage"));
  });

  it("names outputs with a filesystem-safe timestamp", () => {
    expect(timestampName("demo", new Date("2026-01-02T03:04:05.678Z"))).toBe("demo-2026-01-02T03-04-05-678Z");
  });
});
