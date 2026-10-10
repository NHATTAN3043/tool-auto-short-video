import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createProject, type Project } from "@studio/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JsonProjectRepository } from "./json-project-repository";

const make = (id: string, updatedAt = "2026-01-01T00:00:00.000Z"): Project => ({
  ...createProject(
    { name: `Dự án ${id}`, mode: "manual" },
    { newId: () => id, now: "2026-01-01T00:00:00.000Z" },
  ),
  updatedAt,
});

describe("JsonProjectRepository", () => {
  let root = "";
  let repo: JsonProjectRepository;
  const fileOf = (id: string) => path.join(root, "projects", id, "project.json");

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "studio-repo-"));
    repo = new JsonProjectRepository(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("saves to projects/<id>/project.json and reads it back", async () => {
    const project = make("prj_a");
    await repo.save(project);
    expect(await repo.get("prj_a")).toEqual(project);
    expect(JSON.parse(readFileSync(fileOf("prj_a"), "utf8"))).toEqual(project);
    expect(readdirSync(path.dirname(fileOf("prj_a")))).toEqual(["project.json"]);
  });

  it("throws PROJECT_NOT_FOUND for missing or malformed ids", async () => {
    await expect(repo.get("prj_missing")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(repo.get("../../etc")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(repo.save({ ...make("prj_a"), id: "prj_../x" })).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
    });
  });

  it("runs the migration on read", async () => {
    mkdirSync(path.dirname(fileOf("prj_old")), { recursive: true });
    writeFileSync(fileOf("prj_old"), JSON.stringify({ ...make("prj_old"), schemaVersion: 99 }));
    await expect(repo.get("prj_old")).rejects.toMatchObject({ code: "UNSUPPORTED_SCHEMA_VERSION" });
    writeFileSync(fileOf("prj_old"), "{ broken");
    await expect(repo.get("prj_old")).rejects.toMatchObject({ code: "INVALID_PROJECT" });
  });

  it("refuses to write an invalid project", async () => {
    await expect(repo.save({ ...make("prj_a"), fps: 60 } as unknown as Project)).rejects.toMatchObject({
      code: "INVALID_PROJECT",
    });
    expect(existsSync(fileOf("prj_a"))).toBe(false);
  });

  it("lists summaries newest first and skips unreadable projects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await repo.save(make("prj_old", "2026-01-01T00:00:00.000Z"));
    await repo.save({
      ...make("prj_new", "2026-02-01T00:00:00.000Z"),
      scenes: [{ id: "s", narration: "", status: "draft" }],
    });
    mkdirSync(path.join(root, "projects", "prj_broken"), { recursive: true });
    writeFileSync(fileOf("prj_broken"), "nope");
    mkdirSync(path.join(root, "projects", "not-a-project"));

    expect(await repo.list()).toEqual([
      {
        id: "prj_new",
        name: "Dự án prj_new",
        mode: "manual",
        sceneCount: 1,
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "prj_old",
        name: "Dự án prj_old",
        mode: "manual",
        sceneCount: 0,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("lists nothing before any project exists", async () => {
    expect(await repo.list()).toEqual([]);
  });

  it("does not lose concurrent updates", async () => {
    await repo.save(make("prj_a"));
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        repo.update("prj_a", (p) => ({
          ...p,
          scenes: [...p.scenes, { id: `scn_${String(i)}`, narration: String(i), status: "draft" as const }],
        })),
      ),
    );
    expect((await repo.get("prj_a")).scenes).toHaveLength(20);
  });

  it("keeps the stored project when an update fails or changes the id", async () => {
    await repo.save(make("prj_a"));
    await expect(
      repo.update("prj_a", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(repo.update("prj_a", (p) => ({ ...p, id: "prj_b" }))).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
    await expect(repo.update("prj_missing", (p) => p)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect(await repo.get("prj_a")).toEqual(make("prj_a"));
  });

  it("removes the project record so it is no longer read or listed", async () => {
    await repo.save(make("prj_a"));
    await repo.save(make("prj_b"));
    await repo.remove("prj_a");
    expect(existsSync(fileOf("prj_a"))).toBe(false);
    await expect(repo.get("prj_a")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect((await repo.list()).map((summary) => summary.id)).toEqual(["prj_b"]);
    await expect(repo.remove("prj_a")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(repo.remove("../../etc")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});
