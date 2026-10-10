import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LibrarySfx, MediaAsset, Project } from "@studio/domain";
import type { MediaProbePort } from "@studio/services";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getProjectFile } from "@/app/api/projects/[id]/files/[...path]/route";
import { POST as useInProject } from "@/app/api/projects/[id]/sfx/route";
import { POST as createRoute } from "@/app/api/projects/route";
import { GET as getSfxFile } from "@/app/api/sfx/[id]/file/route";
import { DELETE as removeSfx, PATCH as renameSfx } from "@/app/api/sfx/[id]/route";
import { GET as listSfx, POST as uploadSfx } from "@/app/api/sfx/route";

import { resetContainer } from "./container";

/** Stands in for ffprobe: every mp3 is a 1 s sound, everything else a video. */
const fakeProbe: MediaProbePort = {
  probe: (file) =>
    Promise.resolve(
      file.endsWith(".mp3")
        ? { kind: "audio", durationMs: 1000, hasAudio: true }
        : { kind: "video", durationMs: 30_000, width: 1920, height: 1080, fps: 30, hasAudio: true },
    ),
  createThumbnail: () => Promise.resolve(),
};

const SOUND = "pop-pop-pop";

describe("sound effect API", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-sfx-api-"));
    vi.stubEnv("STUDIO_STORAGE_DIR", dir);
    resetContainer({ probe: fakeProbe });
  });

  afterEach(() => {
    resetContainer();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  function uploadRequest(fileName: string): Request {
    const form = new FormData();
    form.append("file", new Blob([SOUND]), fileName);
    return new Request("http://x/api/sfx", { method: "POST", body: form });
  }

  it("uploads, lists, renames and serves library effects", async () => {
    const res = await uploadSfx(uploadRequest("Bốp.mp3"));
    expect(res.status).toBe(201);
    const item = (await res.json()) as LibrarySfx;
    expect(item).toMatchObject({ name: "Bốp", durationMs: 1000 });

    expect(((await (await listSfx()).json()) as LibrarySfx[]).map((sfx) => sfx.id)).toEqual([item.id]);

    const renamed = await renameSfx(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "Pop" }) }),
      ctx(item.id),
    );
    expect(((await renamed.json()) as LibrarySfx).name).toBe("Pop");

    const file = await getSfxFile(new Request("http://x", { headers: { range: "bytes=0-2" } }), ctx(item.id));
    expect(file.status).toBe(206);
    expect(file.headers.get("content-type")).toBe("audio/mpeg");
    expect(await file.text()).toBe("pop");
  });

  it("rejects files that are not audio", async () => {
    const res = await uploadSfx(uploadRequest("clip.mp4"));
    expect(res.status).toBe(422);
  });

  it("copies an effect into a project and keeps it after removal from the library", async () => {
    const item = (await (await uploadSfx(uploadRequest("pop.mp3"))).json()) as LibrarySfx;
    const project = (await (
      await createRoute(
        new Request("http://x/api/projects", {
          method: "POST",
          body: JSON.stringify({ name: "SFX", mode: "manual" }),
        }),
      )
    ).json()) as Project;

    const used = await useInProject(
      new Request("http://x", { method: "POST", body: JSON.stringify({ sfxId: item.id }) }),
      ctx(project.id),
    );
    expect(used.status).toBe(201);
    const { asset } = (await used.json()) as { asset: MediaAsset };
    expect(asset).toMatchObject({ kind: "audio", source: "library" });

    expect((await removeSfx(new Request("http://x"), ctx(item.id))).status).toBe(204);
    expect((await getSfxFile(new Request("http://x"), ctx(item.id))).status).toBe(404);

    const copy = await getProjectFile(new Request("http://x"), {
      params: Promise.resolve({ id: project.id, path: asset.path.split("/") }),
    });
    expect(await copy.text()).toBe(SOUND);
  });

  it("reports an unknown effect", async () => {
    const res = await renameSfx(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "x" }) }),
      ctx("lib_nope"),
    );
    expect(res.status).toBe(404);
  });
});
