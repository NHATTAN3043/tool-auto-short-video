import { scriptToScenes, type Project } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { FakeClock, InMemoryProjectRepository } from "../testing";
import { makeCreateProject } from "./create-project";
import { makeGetProject } from "./get-project";
import { makeListProjects } from "./list-projects";
import { makeSaveProject } from "./save-project";

function setup() {
  const repo = new InMemoryProjectRepository();
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  let n = 0;
  const newId = () => `prj_${String(++n)}`;
  return {
    repo,
    clock,
    create: makeCreateProject({ repo, clock, newId }),
    get: makeGetProject({ repo }),
    list: makeListProjects({ repo }),
    save: makeSaveProject({ repo, clock }),
  };
}

const cover = { sourceStartMs: 0, fit: "cover" as const, focusX: 0.5, volume: 0, kenBurns: false };

describe("project use cases", () => {
  it("creates, reads and lists projects, newest first", async () => {
    const s = setup();
    const first = await s.create({ name: "Một", mode: "manual" });
    s.clock.set("2026-01-02T00:00:00.000Z");
    await s.create({ name: "Hai", mode: "full_ai" });

    expect(first).toMatchObject({ id: "prj_1", name: "Một", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(await s.get("prj_1")).toEqual(first);
    expect(await s.list()).toEqual([
      { id: "prj_2", name: "Hai", mode: "full_ai", sceneCount: 0, updatedAt: "2026-01-02T00:00:00.000Z" },
      { id: "prj_1", name: "Một", mode: "manual", sceneCount: 0, updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("throws PROJECT_NOT_FOUND for an unknown id", async () => {
    await expect(setup().get("prj_nope")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("saves edits, bumps updatedAt and keeps createdAt", async () => {
    const s = setup();
    const created = await s.create({ name: "Một", mode: "manual" });
    s.clock.set("2026-02-01T00:00:00.000Z");
    const saved = await s.save({
      ...created,
      name: "Đã sửa",
      scenes: scriptToScenes("Cảnh một.\n\nCảnh hai."),
      createdAt: "2030-01-01T00:00:00.000Z",
    });
    expect(saved).toMatchObject({
      name: "Đã sửa",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    expect((await s.get(created.id)).scenes).toHaveLength(2);
  });

  it("keeps server-side assets when a stale client copy is saved", async () => {
    const s = setup();
    const stale = await s.create({ name: "A", mode: "manual" });
    await s.repo.update(stale.id, (p) => ({
      ...p,
      assets: [
        {
          id: "ast_new",
          kind: "video",
          source: "upload",
          fileName: "a.mp4",
          path: "media/ast_new.mp4",
          createdAt: p.createdAt,
        },
      ],
    }));
    const saved = await s.save({ ...stale, name: "B" });
    expect(saved.assets.map((a) => a.id)).toEqual(["ast_new"]);
  });

  it("rejects invalid data, unknown projects and dangling asset references", async () => {
    const s = setup();
    const created = await s.create({ name: "A", mode: "manual" });
    await expect(s.save({ ...created, fps: 60 })).rejects.toMatchObject({ code: "INVALID_PROJECT" });
    await expect(s.save("nope")).rejects.toMatchObject({ code: "INVALID_PROJECT" });
    await expect(s.save({ ...created, id: "prj_other" })).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
    });

    const dangling: Project = {
      ...created,
      scenes: [{ id: "scn_1", narration: "x", status: "draft", media: { ...cover, assetId: "ast_gone" } }],
    };
    await expect(s.save(dangling)).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
    expect((await s.get(created.id)).scenes).toEqual([]);
  });
});
