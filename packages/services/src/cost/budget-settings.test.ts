import { createProject, type ApiUsageEntry } from "@studio/domain";
import { describe, expect, it } from "vitest";

import {
  FakeClock,
  InMemoryApiUsageLog,
  InMemoryBudgetSettings,
  InMemoryProjectRepository,
  NO_BUDGET_LIMITS,
} from "../testing";
import { makeGetBudgetSettings, makeGetUsageReport, makeSaveBudgetSettings } from "./budget-settings";

const defaults = { ...NO_BUDGET_LIMITS, perDayUsd: 2 };

const entry = (id: string, extra: Partial<ApiUsageEntry> = {}): ApiUsageEntry => ({
  id,
  service: "tts",
  provider: "elevenlabs",
  operation: "speech",
  projectId: "prj_1",
  status: "ok",
  estimatedUsd: 0.01,
  usd: 0.01,
  createdAt: "2026-10-10T10:00:00.000Z",
  ...extra,
});

describe("budget settings", () => {
  it("shows the environment defaults until saved, then the saved limits", async () => {
    const store = new InMemoryBudgetSettings();
    const clock = new FakeClock("2026-10-10T12:00:00.000Z");
    const get = makeGetBudgetSettings({ store, defaults });
    expect(await get()).toEqual({ limits: defaults, defaults, updatedAt: null });

    await makeSaveBudgetSettings({ store, clock })({ ...NO_BUDGET_LIMITS, perMonthUsd: 15 });
    expect(await get()).toEqual({
      limits: { ...NO_BUDGET_LIMITS, perMonthUsd: 15 },
      defaults,
      updatedAt: "2026-10-10T12:00:00.000Z",
    });
  });

  it("rejects negative limits", async () => {
    const save = makeSaveBudgetSettings({ store: new InMemoryBudgetSettings(), clock: new FakeClock() });
    await expect(save({ ...NO_BUDGET_LIMITS, perCallUsd: -1 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("usage report", () => {
  it("names projects, keeps unknown ones and lists the newest calls first", async () => {
    const repo = new InMemoryProjectRepository();
    await repo.save(createProject({ name: "Mèo", mode: "assisted" }, { newId: () => "prj_1" }));
    const log = new InMemoryApiUsageLog();
    await log.append(entry("use_1"));
    await log.append(entry("use_2", { projectId: "prj_gone", usd: 0.5 }));
    await log.append(entry("use_3", { status: "blocked", usd: 0 }));

    const report = await makeGetUsageReport({
      log,
      repo,
      clock: new FakeClock("2026-10-10T12:00:00.000Z"),
    })();
    expect(report.totalUsd).toBeCloseTo(0.51, 9);
    expect(report.byProject.map((row) => [row.projectId, row.projectName, row.blockedCalls])).toEqual([
      ["prj_gone", null, 0],
      ["prj_1", "Mèo", 1],
    ]);
    expect(report.recent.map((item) => item.id)).toEqual(["use_3", "use_2", "use_1"]);
  });
});
