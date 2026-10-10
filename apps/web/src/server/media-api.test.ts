import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assignMedia,
  insertSceneAfter,
  updateSceneMedia,
  type MediaAsset,
  type Project,
} from "@studio/domain";
import type { MediaProbePort } from "@studio/services";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as upload } from "@/app/api/projects/[id]/assets/route";
import { GET as getFile, HEAD as headFile } from "@/app/api/projects/[id]/files/[...path]/route";
import { GET as getOne, PUT } from "@/app/api/projects/[id]/route";
import { POST as createRoute } from "@/app/api/projects/route";

import { resetContainer } from "./container";

/** Stands in for ffprobe/ffmpeg: every mp4 is a 30 s 1080p clip, every png an image. */
const fakeProbe: MediaProbePort = {
  probe: (file) =>
    Promise.resolve(
      file.endsWith(".png")
        ? { kind: "image", width: 800, height: 600, hasAudio: false }
        : { kind: "video", durationMs: 30_000, width: 1920, height: 1080, fps: 30, hasAudio: true },
    ),
  createThumbnail: (_input, output) => {
    writeFileSync(output, "jpg");
    return Promise.resolve();
  },
};

const VIDEO_BYTES = "0123456789".repeat(100);

describe("media API", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-media-"));
    vi.stubEnv("STUDIO_STORAGE_DIR", dir);
    resetContainer({ probe: fakeProbe });
  });

  afterEach(() => {
    resetContainer();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const fileCtx = (id: string, ...segments: string[]) => ({
    params: Promise.resolve({ id, path: segments }),
  });

  async function newProject(): Promise<Project> {
    const res = await createRoute(
      new Request("http://x/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "Media", mode: "manual" }),
      }),
    );
    return (await res.json()) as Project;
  }

  function uploadRequest(
    projectId: string,
    fileName: string,
    content: string | Uint8Array<ArrayBuffer>,
  ): Request {
    const form = new FormData();
    form.append("file", new Blob([content]), fileName);
    return new Request(`http://x/api/projects/${projectId}/assets`, { method: "POST", body: form });
  }

  async function uploadOk(projectId: string, fileName: string): Promise<MediaAsset> {
    const res = await upload(uploadRequest(projectId, fileName, VIDEO_BYTES), ctx(projectId));
    expect(res.status).toBe(201);
    return ((await res.json()) as { asset: MediaAsset }).asset;
  }

  async function reload(projectId: string): Promise<Project> {
    resetContainer({ probe: fakeProbe });
    return (await (await getOne(new Request("http://x"), ctx(projectId))).json()) as Project;
  }

  it("uploads a file with a Vietnamese name and lists it in the project", async () => {
    const project = await newProject();
    const asset = await uploadOk(project.id, "Cảnh đẹp 1.mp4");
    expect(asset).toMatchObject({
      kind: "video",
      fileName: "Cảnh đẹp 1.mp4",
      durationMs: 30_000,
      width: 1920,
      height: 1080,
      thumbnailPath: `thumbnails/${asset.id}.jpg`,
    });
    expect((await reload(project.id)).assets).toEqual([asset]);
  });

  it("meets the M6 criterion: upload MP4, assign to scene 3 at 15s–22s, save, reload", async () => {
    const created = await newProject();
    const asset = await uploadOk(created.id, "clip.mp4");

    // What the editor does in the browser: domain operations on its copy, then an autosave PUT.
    let edited = (await (await getOne(new Request("http://x"), ctx(created.id))).json()) as Project;
    for (const id of ["s3", "s2", "s1"]) edited = insertSceneAfter(edited, null, {}, { newId: () => id });
    edited = assignMedia(edited, "s3", { assetId: asset.id });
    edited = updateSceneMedia(edited, "s3", { sourceStartMs: 15_000, sourceEndMs: 22_000 });
    const put = await PUT(
      new Request("http://x", { method: "PUT", body: JSON.stringify(edited) }),
      ctx(created.id),
    );
    expect(put.status).toBe(200);

    const reloaded = await reload(created.id);
    expect(reloaded.scenes.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(reloaded.scenes[2]?.media).toEqual({
      assetId: asset.id,
      sourceStartMs: 15_000,
      sourceEndMs: 22_000,
      fit: "cover",
      focusX: 0.5,
      volume: 0,
      kenBurns: false,
    });
  });

  it("rejects unsupported files, non-multipart bodies and unknown projects", async () => {
    const project = await newProject();
    const exe = await upload(uploadRequest(project.id, "virus.exe", "MZ"), ctx(project.id));
    expect(exe.status).toBe(422);
    const json = await upload(
      new Request("http://x", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
      ctx(project.id),
    );
    expect(json.status).toBe(400);
    const missing = await upload(uploadRequest("prj_missing", "a.mp4", "x"), ctx("prj_missing"));
    expect(missing.status).toBe(404);
    expect((await reload(project.id)).assets).toEqual([]);
  });

  it("rejects a file over the limit with 413 and keeps nothing", async () => {
    vi.stubEnv("STUDIO_MAX_UPLOAD_MB", "1");
    resetContainer({ probe: fakeProbe });
    const project = await newProject();
    const big = new Uint8Array(1024 * 1024 + 10);
    const res = await upload(uploadRequest(project.id, "big.mp4", big), ctx(project.id));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "FILE_TOO_LARGE" } });
    const mediaDir = path.join(dir, "projects", project.id, "media");
    expect(existsSync(mediaDir) ? readdirSync(mediaDir) : []).toEqual([]);
  });

  it("serves files whole and by byte range, and supports HEAD", async () => {
    const project = await newProject();
    const asset = await uploadOk(project.id, "clip.mp4");
    const [folder = "", name = ""] = asset.path.split("/");

    const whole = await getFile(new Request("http://x"), fileCtx(project.id, folder, name));
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(await whole.text()).toBe(VIDEO_BYTES);

    const partial = await getFile(
      new Request("http://x", { headers: { range: "bytes=10-19" } }),
      fileCtx(project.id, folder, name),
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(partial.headers.get("content-length")).toBe("10");
    expect(await partial.text()).toBe("0123456789");

    const tooFar = await getFile(
      new Request("http://x", { headers: { range: "bytes=5000-" } }),
      fileCtx(project.id, folder, name),
    );
    expect(tooFar.status).toBe(416);
    expect(tooFar.headers.get("content-range")).toBe("bytes */1000");

    const head = await headFile(
      new Request("http://x", { method: "HEAD" }),
      fileCtx(project.id, folder, name),
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("1000");
    expect(head.body).toBeNull();
  });

  it.each([
    ["parent segments", ["media", "..", "..", "..", "secret.txt"]],
    ["backslashes", ["media", "..\\..\\..\\secret.txt"]],
    ["project.json", ["project.json"]],
    ["an encoded slash kept in one segment", ["media", "../../../secret.txt"]],
  ])("blocks path traversal through %s", async (_label, segments) => {
    writeFileSync(path.join(dir, "secret.txt"), "top secret");
    const project = await newProject();
    const res = await getFile(new Request("http://x"), fileCtx(project.id, ...segments));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("top secret");
  });

  it("blocks a project id that escapes the projects folder", async () => {
    writeFileSync(path.join(dir, "secret.txt"), "top secret");
    const res = await getFile(new Request("http://x"), fileCtx("..", "secret.txt"));
    expect(res.status).toBe(404);
  });
});
