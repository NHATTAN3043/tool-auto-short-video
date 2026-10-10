import { describe, expect, it } from "vitest";

import { DomainError } from "../errors";
import { newId } from "../ids";
import { RenderJobSchema } from "../render/schema";
import { SceneMediaSchema } from "../scene/schema";
import { asset, NOW, project, scene } from "../testing/fixtures";
import { createProject, CreateProjectInputSchema } from "./create-project";
import { migrateProject } from "./migrations";
import { MODE_PRESETS } from "./presets";
import { ProjectSchema } from "./schema";

describe("createProject", () => {
  const ctx = { newId: () => "prj_x", now: NOW };

  it("creates a valid empty 1080x1920 30fps project from the manual preset", () => {
    const created = createProject({ name: "  Video 1 ", mode: "manual" }, ctx);
    expect(ProjectSchema.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      schemaVersion: 1,
      id: "prj_x",
      name: "Video 1",
      width: 1080,
      height: 1920,
      fps: 30,
      scenes: [],
      assets: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(Object.values(created.automationSettings).every((on) => !on)).toBe(true);
    expect(created.style.captions.positionY).toBe(0.62);
    expect(created.style.captions.maxWordsPerCaption).toBe(6);
  });

  it("turns every toggle on for full_ai", () => {
    const created = createProject({ name: "AI", mode: "full_ai" }, ctx);
    expect(Object.values(created.automationSettings).every(Boolean)).toBe(true);
  });

  it("applies overrides on top of the preset and ignores undefined values", () => {
    const created = createProject(
      {
        name: "A",
        mode: "assisted",
        overrides: { voiceGeneration: false, scriptGeneration: true, mediaSearch: undefined },
      },
      ctx,
    );
    expect(created.automationSettings).toEqual({
      ...MODE_PRESETS.assisted,
      voiceGeneration: false,
      scriptGeneration: true,
    });
  });

  it("does not share mutable defaults between projects", () => {
    const a = createProject({ name: "A", mode: "manual" }, ctx);
    a.style.captions.fontSize = 1;
    a.automationSettings.mediaSearch = true;
    const b = createProject({ name: "B", mode: "manual" }, ctx);
    expect(b.style.captions.fontSize).not.toBe(1);
    expect(MODE_PRESETS.manual.mediaSearch).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(() => createProject({ name: "   ", mode: "manual" }, ctx)).toThrow(DomainError);
  });

  it("generates prefixed ids and an ISO date by default", () => {
    const created = createProject({ name: "A", mode: "manual" });
    expect(created.id).toMatch(/^prj_[0-9a-f-]{36}$/u);
    expect(() => new Date(created.createdAt).toISOString()).not.toThrow();
    expect(newId("scn")).not.toBe(newId("scn"));
  });
});

describe("schemas", () => {
  it("rejects invalid scene media", () => {
    const valid = { assetId: "a", sourceStartMs: 0, fit: "cover", focusX: 0.5, volume: 0, kenBurns: false };
    expect(SceneMediaSchema.safeParse(valid).success).toBe(true);
    expect(SceneMediaSchema.safeParse({ ...valid, focusX: 1.2 }).success).toBe(false);
    expect(SceneMediaSchema.safeParse({ ...valid, sourceStartMs: -1 }).success).toBe(false);
    expect(SceneMediaSchema.safeParse({ ...valid, sourceStartMs: 5000, sourceEndMs: 5000 }).success).toBe(
      false,
    );
  });

  it("rejects a project with wrong dimensions", () => {
    expect(ProjectSchema.safeParse({ ...project(), width: 1920 }).success).toBe(false);
  });

  it("validates render jobs", () => {
    const job = { id: "job_1", projectId: "prj_1", status: "QUEUED", progress: 0, createdAt: NOW };
    expect(RenderJobSchema.parse(job)).toEqual(job);
    expect(RenderJobSchema.safeParse({ ...job, progress: 2 }).success).toBe(false);
    expect(RenderJobSchema.safeParse({ ...job, status: "DONE" }).success).toBe(false);
  });
});

describe("migrateProject", () => {
  it("returns a parsed v1 project, including scenes and assets", () => {
    const stored = project({
      scenes: [scene("scn_1", "Xin chào")],
      assets: [asset("ast_1", "video", { durationMs: 1000 })],
    });
    const raw: unknown = JSON.parse(JSON.stringify(stored));
    expect(migrateProject(raw)).toEqual(stored);
  });

  it.each([
    [{ ...project(), schemaVersion: 2 }, "UNSUPPORTED_SCHEMA_VERSION"],
    [{ ...project(), schemaVersion: 0 }, "UNSUPPORTED_SCHEMA_VERSION"],
    [{ name: "no version" }, "UNSUPPORTED_SCHEMA_VERSION"],
    [null, "INVALID_PROJECT"],
    ["text", "INVALID_PROJECT"],
    [{ ...project(), fps: 60 }, "INVALID_PROJECT"],
  ])("rejects %j with %s", (raw, code) => {
    expect(() => migrateProject(raw)).toThrow(expect.objectContaining({ code }));
  });
});

describe("CreateProjectInputSchema", () => {
  it("accepts a valid request, trimming the name", () => {
    expect(
      CreateProjectInputSchema.parse({
        name: "  Video  ",
        mode: "assisted",
        overrides: { mediaSearch: false },
      }),
    ).toEqual({ name: "Video", mode: "assisted", overrides: { mediaSearch: false } });
    expect(CreateProjectInputSchema.parse({ name: "A", mode: "manual" })).toEqual({
      name: "A",
      mode: "manual",
    });
  });

  it.each([
    [{ name: "   ", mode: "manual" }],
    [{ name: "x".repeat(121), mode: "manual" }],
    [{ name: "A", mode: "auto" }],
    [{ name: "A", mode: "manual", overrides: { unknownToggle: true } }],
    [{ name: "A", mode: "manual", overrides: { mediaSearch: "yes" } }],
    [{ mode: "manual" }],
  ])("rejects %j", (input) => {
    expect(CreateProjectInputSchema.safeParse(input).success).toBe(false);
  });
});
