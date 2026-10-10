import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ApiUsageEntry, BudgetSettings } from "@studio/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonApiUsageLog, JsonBudgetSettings } from "./json-cost-store";

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

describe("JSON cost store", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-cost-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends usage, filters it and survives a new instance", async () => {
    const log = new JsonApiUsageLog(dir);
    expect(await log.list()).toEqual([]);
    await Promise.all([
      log.append(entry("use_1")),
      log.append(entry("use_2", { projectId: "prj_2", usd: 0.02 })),
      log.append(entry("use_3", { usd: 1, createdAt: "2026-10-01T00:00:00.000Z" })),
    ]);
    const reopened = new JsonApiUsageLog(dir);
    expect((await reopened.list()).map((item) => item.id).sort()).toEqual(["use_1", "use_2", "use_3"]);
    expect(await reopened.totalUsd({ projectId: "prj_1" })).toBeCloseTo(1.01, 9);
    expect(await reopened.totalUsd({ since: "2026-10-09T12:00:00.000Z" })).toBeCloseTo(0.03, 9);
    expect((await reopened.list({ projectId: "prj_2" })).map((item) => item.id)).toEqual(["use_2"]);
  });

  it("rejects invalid entries before writing", async () => {
    const log = new JsonApiUsageLog(dir);
    await expect(log.append({ ...entry("use_1"), usd: -1 })).rejects.toThrow();
    expect(await log.list()).toEqual([]);
  });

  it("ignores a last line cut by a crash, but not corruption in the middle", async () => {
    const file = path.join(dir, "usage", "api-usage.jsonl");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(entry("use_1"))}\n{"id":"use_2","serv`, "utf8");
    expect((await new JsonApiUsageLog(dir).list()).map((item) => item.id)).toEqual(["use_1"]);

    appendFileSync(file, `\n${JSON.stringify(entry("use_3"))}\n`, "utf8");
    await expect(new JsonApiUsageLog(dir).list()).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("saves budget settings and reads them back", async () => {
    const store = new JsonBudgetSettings(dir);
    expect(await store.get()).toBeNull();
    await store.save(settings);
    expect(await new JsonBudgetSettings(dir).get()).toEqual(settings);
    await expect(
      store.save({ ...settings, limits: { ...settings.limits, perDayUsd: -1 } }),
    ).rejects.toThrow();
  });
});
