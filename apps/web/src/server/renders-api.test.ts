import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FileJobQueue } from "@studio/adapters/queue-file";
import { scriptToScenes, type Project, type RenderJob } from "@studio/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getFile } from "@/app/api/projects/[id]/files/[...path]/route";
import { GET as getJob } from "@/app/api/projects/[id]/renders/[jobId]/route";
import { GET as listJobs, POST as requestRender } from "@/app/api/projects/[id]/renders/route";
import { PUT } from "@/app/api/projects/[id]/route";
import { POST as createRoute } from "@/app/api/projects/route";

import { resetContainer } from "./container";

describe("render API", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-renders-"));
    vi.stubEnv("STUDIO_STORAGE_DIR", dir);
    resetContainer();
  });

  afterEach(() => {
    resetContainer();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const jobCtx = (id: string, jobId: string) => ({ params: Promise.resolve({ id, jobId }) });
  const post = (id: string) => requestRender(new Request("http://x", { method: "POST" }), ctx(id));

  async function projectWithScenes(script: string): Promise<Project> {
    const created = (await (
      await createRoute(
        new Request("http://x", { method: "POST", body: JSON.stringify({ name: "Render", mode: "manual" }) }),
      )
    ).json()) as Project;
    if (script === "") return created;
    const edited = { ...created, script, scenes: scriptToScenes(script) };
    const res = await PUT(
      new Request("http://x", { method: "PUT", body: JSON.stringify(edited) }),
      ctx(created.id),
    );
    return (await res.json()) as Project;
  }

  it("queues a render, returns the same job while it is active, and lists it", async () => {
    const project = await projectWithScenes("Một hai ba.");
    const first = await post(project.id);
    expect(first.status).toBe(202);
    const job = (await first.json()) as RenderJob;
    expect(job).toMatchObject({ projectId: project.id, status: "QUEUED", progress: 0 });

    const again = (await (await post(project.id)).json()) as RenderJob;
    expect(again.id).toBe(job.id);

    const listed = (await (await listJobs(new Request("http://x"), ctx(project.id))).json()) as RenderJob[];
    expect(listed.map((j) => j.id)).toEqual([job.id]);
    const polled = await getJob(new Request("http://x"), jobCtx(project.id, job.id));
    expect(((await polled.json()) as RenderJob).status).toBe("QUEUED");
  });

  it("queues a CapCut export on request and rejects an unknown kind", async () => {
    const project = await projectWithScenes("Một hai ba.");
    const capcut = (body: string) =>
      requestRender(new Request("http://x", { method: "POST", body }), ctx(project.id));

    const res = await capcut(JSON.stringify({ kind: "capcut" }));
    expect(res.status).toBe(202);
    expect((await res.json()) as RenderJob).toMatchObject({ kind: "capcut", status: "QUEUED" });
    expect((await capcut(JSON.stringify({ kind: "gif" }))).status).toBe(400);
    expect((await capcut("{oops")).status).toBe(400);
  });

  it("shows a finished job with downloadable MP4 and SRT", async () => {
    const project = await projectWithScenes("Một hai ba.");
    const job = (await (await post(project.id)).json()) as RenderJob;

    // Stand-in for the worker: claim the job, write the outputs, mark it done.
    const queue = new FileJobQueue(dir);
    await queue.claimNext();
    const renderDir = path.join(dir, "projects", project.id, "render");
    mkdirSync(renderDir, { recursive: true });
    writeFileSync(path.join(renderDir, `${job.id}.mp4`), "MP4DATA");
    writeFileSync(path.join(renderDir, `${job.id}.srt`), "1\n00:00:00,000 --> 00:00:01,000\nMột\n");
    await queue.update(job.id, {
      status: "COMPLETED",
      progress: 1,
      outputPath: `render/${job.id}.mp4`,
      srtPath: `render/${job.id}.srt`,
    });

    const done = (await (
      await getJob(new Request("http://x"), jobCtx(project.id, job.id))
    ).json()) as RenderJob;
    expect(done).toMatchObject({ status: "COMPLETED", progress: 1, outputPath: `render/${job.id}.mp4` });

    const mp4 = await getFile(new Request("http://x"), {
      params: Promise.resolve({ id: project.id, path: ["render", `${job.id}.mp4`] }),
    });
    expect(mp4.status).toBe(200);
    expect(mp4.headers.get("content-type")).toBe("video/mp4");
    expect(mp4.headers.get("cache-control")).toBe("no-store");
    expect(await mp4.text()).toBe("MP4DATA");

    // A finished job frees the project for a new render.
    const next = (await (await post(project.id)).json()) as RenderJob;
    expect(next.id).not.toBe(job.id);
  });

  it("refuses to render a project without scenes", async () => {
    const project = await projectWithScenes("");
    const res = await post(project.id);
    expect(res.status).toBe(409);
  });

  it("hides jobs of other projects and unknown ids", async () => {
    const a = await projectWithScenes("Một.");
    const b = await projectWithScenes("Hai.");
    const job = (await (await post(a.id)).json()) as RenderJob;
    expect((await getJob(new Request("http://x"), jobCtx(b.id, job.id))).status).toBe(404);
    expect((await getJob(new Request("http://x"), jobCtx(a.id, "job_missing"))).status).toBe(404);
    expect((await getJob(new Request("http://x"), jobCtx(a.id, "../../projects"))).status).toBe(404);
    expect((await listJobs(new Request("http://x"), ctx("prj_missing"))).status).toBe(404);
  });
});

describe("preview font", () => {
  it("is the exact file the renderer uses, so preview and render look the same", () => {
    const repo = path.resolve(import.meta.dirname, "../../../..");
    const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
    expect(hash(path.join(repo, "apps/web/public/fonts/BeVietnamPro-ExtraBold.ttf"))).toBe(
      hash(path.join(repo, "packages/video/public/fonts/BeVietnamPro-ExtraBold.ttf")),
    );
  });
});
