import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FileJobQueue } from "@studio/adapters/queue-file";
import type { Project } from "@studio/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET as getOne, PUT } from "@/app/api/projects/[id]/route";
import { GET as list, POST } from "@/app/api/projects/route";

import { resetContainer } from "./container";

// Route handlers end to end against a real JSON repository in a temp folder.
describe("/api/projects", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-web-"));
    vi.stubEnv("STUDIO_STORAGE_DIR", dir);
    resetContainer();
  });

  afterEach(() => {
    resetContainer();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const json = (method: string, body: unknown) =>
    new Request("http://localhost/api/projects", { method, body: JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function create(body: unknown): Promise<Project> {
    const res = await POST(json("POST", body));
    expect(res.status).toBe(201);
    return (await res.json()) as Project;
  }

  it("creates a project from a mode preset with overrides and lists it", async () => {
    const project = await create({
      name: "  Video đầu tiên ",
      mode: "assisted",
      overrides: { mediaSearch: false },
    });
    expect(project).toMatchObject({
      name: "Video đầu tiên",
      mode: "assisted",
      automationSettings: {
        scenePlanning: true,
        voiceGeneration: true,
        mediaSearch: false,
        scriptGeneration: false,
      },
    });

    const res = await list();
    expect(await res.json()).toEqual([
      {
        id: project.id,
        name: "Video đầu tiên",
        mode: "assisted",
        sceneCount: 0,
        updatedAt: project.updatedAt,
      },
    ]);
  });

  it("persists toggle changes across reads (the M4 acceptance criterion)", async () => {
    const project = await create({ name: "A", mode: "manual" });
    const edited = {
      ...project,
      mode: "full_ai",
      automationSettings: { ...project.automationSettings, voiceGeneration: true },
    };
    const put = await PUT(json("PUT", edited), ctx(project.id));
    expect(put.status).toBe(200);

    // A fresh container re-reads from disk, like a page reload after a server restart.
    resetContainer();
    const reloaded = (await (await getOne(new Request("http://x"), ctx(project.id))).json()) as Project;
    expect(reloaded.mode).toBe("full_ai");
    expect(reloaded.automationSettings.voiceGeneration).toBe(true);
    expect(reloaded.automationSettings.mediaSearch).toBe(false);
  });

  it("returns 404 for unknown projects", async () => {
    const res = await getOne(new Request("http://x"), ctx("prj_missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "PROJECT_NOT_FOUND", message: "Không tìm thấy dự án." },
    });
  });

  it.each([
    ["an empty name", { name: " ", mode: "manual" }],
    ["an unknown mode", { name: "A", mode: "turbo" }],
    ["an unknown toggle", { name: "A", mode: "manual", overrides: { teleport: true } }],
  ])("rejects creating with %s", async (_label, body) => {
    expect((await POST(json("POST", body))).status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const res = await POST(new Request("http://localhost/api/projects", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
  });

  it("rejects a PUT whose body id differs from the URL, and invalid projects", async () => {
    const project = await create({ name: "A", mode: "manual" });
    expect((await PUT(json("PUT", { ...project, id: "prj_other" }), ctx(project.id))).status).toBe(400);
    expect((await PUT(json("PUT", { ...project, fps: 60 }), ctx(project.id))).status).toBe(400);
    expect((await PUT(json("PUT", { ...project, id: "prj_x" }), ctx("prj_x"))).status).toBe(404);
  });

  it("deletes a project with its files and jobs, but not while a job is active", async () => {
    const project = await create({ name: "Xoá tôi", mode: "manual" });
    const folder = path.join(dir, "projects", project.id);
    mkdirSync(path.join(folder, "media"), { recursive: true });
    writeFileSync(path.join(folder, "media", "a.mp4"), "x");
    const queue = new FileJobQueue(dir);
    const job = { id: "job_1", projectId: project.id, status: "QUEUED" as const, progress: 0 };
    await queue.enqueue({ ...job, createdAt: "2026-10-10T00:00:00.000Z" });
    const remove = () => DELETE(new Request("http://localhost", { method: "DELETE" }), ctx(project.id));

    const busy = await remove();
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: { code: "PROJECT_BUSY" } });
    expect(existsSync(path.join(folder, "media", "a.mp4"))).toBe(true);

    await queue.update("job_1", { status: "COMPLETED", progress: 1 });
    const done = await remove();
    expect(done.status).toBe(204);
    expect(existsSync(folder)).toBe(false);
    expect(await queue.list()).toEqual([]);
    expect((await getOne(new Request("http://localhost"), ctx(project.id))).status).toBe(404);
    expect(await (await list()).json()).toEqual([]);
    expect((await remove()).status).toBe(404);
  });
});
