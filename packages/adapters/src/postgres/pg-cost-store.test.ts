import type { ApiUsageEntry, BudgetSettings } from "@studio/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PgDatabase } from "./database";
import { PgApiUsageLog, PgBudgetSettings } from "./pg-cost-store";
import { createTestDatabase, TEST_DATABASE_URL, truncateAll, type TestDatabase } from "./test-database";

const entry = (id: string, extra: Partial<ApiUsageEntry> = {}): ApiUsageEntry => ({
  id,
  service: "ai",
  provider: "claude",
  operation: "script",
  projectId: "prj_1",
  status: "ok",
  estimatedUsd: 0.04,
  usd: 0.01,
  createdAt: "2026-10-10T10:00:00.000Z",
  ...extra,
});

const settings: BudgetSettings = {
  schemaVersion: 1,
  limits: { perCallUsd: 0.5, perDayUsd: 2, perMonthUsd: null, perProjectUsd: 1 },
  updatedAt: "2026-10-10T12:00:00.000Z",
};

describe.skipIf(TEST_DATABASE_URL === undefined)("Postgres cost store", () => {
  let testDb: TestDatabase;
  let database: PgDatabase;
  let log: PgApiUsageLog;
  let store: PgBudgetSettings;

  beforeAll(async () => {
    testDb = await createTestDatabase(TEST_DATABASE_URL ?? "");
    database = testDb.connect();
    log = new PgApiUsageLog(database.db);
    store = new PgBudgetSettings(database.db);
  });

  afterAll(async () => {
    await testDb.drop();
  });

  beforeEach(async () => {
    await truncateAll(database);
  });

  it("appends usage, sums and lists it oldest first, with optional fields round-tripped", async () => {
    expect(await log.totalUsd()).toBe(0);
    const full = entry("use_1", {
      model: "claude-sonnet-5-5",
      jobId: "job_1",
      inputTokens: 100,
      outputTokens: 50,
      message: "refusal",
      status: "failed",
    });
    await log.append(full);
    await log.append(
      entry("use_2", { projectId: "prj_2", usd: 0.02, createdAt: "2026-10-10T11:00:00.000Z" }),
    );
    await log.append(entry("use_3", { usd: 1, createdAt: "2026-10-01T00:00:00.000Z" }));
    await log.append(entry("use_4", { service: "tts", provider: "elevenlabs", characters: 300 }));
    const bare = entry("use_5", { status: "blocked", usd: 0 });
    delete bare.projectId;
    await log.append(bare);

    expect((await log.list()).map((item) => item.id)).toEqual(["use_3", "use_1", "use_4", "use_5", "use_2"]);
    expect((await log.list({ projectId: "prj_1" }))[1]).toEqual(full);
    expect(await log.totalUsd({ projectId: "prj_1" })).toBeCloseTo(1.02, 9);
    expect(await log.totalUsd({ since: "2026-10-09T12:00:00.000Z" })).toBeCloseTo(0.04, 9);
    expect((await log.list())[3]).toEqual(bare);
  });

  it("saves the single settings row and overwrites it", async () => {
    expect(await store.get()).toBeNull();
    await store.save(settings);
    const changed = { ...settings, limits: { ...settings.limits, perMonthUsd: 20 } };
    await store.save(changed);
    expect(await store.get()).toEqual(changed);
  });
});
