import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LibraryMedia, MediaAsset, MediaCandidate, Project } from "@studio/domain";
import type { MediaProbePort } from "@studio/services";
import { FakeMediaSearch, FakeRemoteFiles } from "@studio/services/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as libraryFile } from "@/app/api/media-library/[id]/file/route";
import { DELETE as removeItem, PATCH as patchItem } from "@/app/api/media-library/[id]/route";
import { GET as listLibrary } from "@/app/api/media-library/route";
import { GET as proxy } from "@/app/api/media-proxy/route";
import { POST as importRoute } from "@/app/api/projects/[id]/media-search/import/route";
import { GET as searchRoute } from "@/app/api/projects/[id]/media-search/route";
import { POST as createRoute } from "@/app/api/projects/route";

import { resetContainer } from "./container";

/** Every download is a 1080×1920 clip. */
const fakeProbe: MediaProbePort = {
  probe: () =>
    Promise.resolve({ kind: "video", durationMs: 8000, width: 1080, height: 1920, fps: 30, hasAudio: false }),
  createThumbnail: () => Promise.resolve(),
};

const clip: MediaCandidate = {
  provider: "pexels",
  ref: "7",
  kind: "video",
  width: 1080,
  height: 1920,
  thumbnail: { type: "remote", url: "https://cdn.pexels.test/7.jpg" },
  preview: { type: "remote", url: "https://cdn.pexels.test/7-small.mp4" },
};

describe("media search API", () => {
  let dir = "";
  let pexels: FakeMediaSearch;
  let remote: FakeRemoteFiles;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-search-"));
    vi.stubEnv("STUDIO_STORAGE_DIR", dir);
    pexels = new FakeMediaSearch("pexels");
    pexels.results = [clip];
    remote = new FakeRemoteFiles();
    resetContainer({ probe: fakeProbe, stockProviders: [pexels], remote });
  });

  afterEach(() => {
    resetContainer();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function project(mode: "manual" | "assisted"): Promise<Project> {
    const res = await createRoute(
      new Request("http://x", { method: "POST", body: JSON.stringify({ name: "Tìm", mode }) }),
    );
    return (await res.json()) as Project;
  }

  const search = (p: Project, query: string) => searchRoute(new Request(`http://x/api?${query}`), ctx(p.id));
  const importClip = (p: Project) =>
    importRoute(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ candidate: { provider: "pexels", ref: "7", kind: "video" }, query: "mèo" }),
      }),
      ctx(p.id),
    );

  it("searches stock with the language, imports a pick into the project and the shared library", async () => {
    const p = await project("assisted");
    const res = await search(p, "q=%E5%B0%8F%E7%8C%AB&kind=video&lang=zh");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: MediaCandidate[]; stockProviders: string[] };
    expect(body.candidates.map((c) => c.ref)).toEqual(["7"]);
    expect(body.stockProviders).toEqual(["pexels"]);
    expect(pexels.searches[0]).toMatchObject({ query: "小猫", lang: "zh" });

    const imported = await importClip(p);
    expect(imported.status).toBe(201);
    const { asset } = (await imported.json()) as { asset: MediaAsset };
    expect(asset).toMatchObject({ kind: "video", source: "pexels", width: 1080, height: 1920 });

    const library = (await (await listLibrary()).json()) as LibraryMedia[];
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({ tags: ["mèo"], usageCount: 1 });
    const again = (await (await search(p, "q=m%C3%A8o&kind=video")).json()) as {
      candidates: MediaCandidate[];
    };
    expect(again.candidates[0]).toMatchObject({ provider: "library", ref: library[0]?.id });
  });

  it("only searches the library in Manual mode and refuses stock imports there", async () => {
    const p = await project("manual");
    const body = (await (await search(p, "q=cat&kind=video")).json()) as {
      candidates: unknown[];
      stockProviders: string[];
    };
    expect(body).toMatchObject({ candidates: [], stockProviders: [] });
    expect((await importClip(p)).status).toBe(409);
  });

  it("rejects invalid search parameters", async () => {
    const p = await project("assisted");
    expect((await search(p, "q=&kind=video")).status).toBe(400);
    expect((await search(p, "q=cat&kind=audio")).status).toBe(400);
    expect((await search(p, "q=cat&kind=video&lang=fr")).status).toBe(400);
  });

  it("proxies provider media with Range and refuses other hosts", async () => {
    const ok = await proxy(
      new Request("http://x/api/media-proxy?url=https%3A%2F%2Fcdn.pexels.test%2F7-small.mp4", {
        headers: { range: "bytes=0-" },
      }),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("video/mp4");
    expect(remote.opened.at(-1)).toEqual({ url: "https://cdn.pexels.test/7-small.mp4", range: "bytes=0-" });
    const evil = await proxy(
      new Request("http://x/api/media-proxy?url=https%3A%2F%2F169.254.169.254%2Flatest"),
    );
    expect(evil.status).toBe(404);
  });

  it("edits tags, serves files and deletes library items", async () => {
    const p = await project("assisted");
    await importClip(p);
    const [item] = (await (await listLibrary()).json()) as LibraryMedia[];
    const id = item?.id ?? "";
    const patched = await patchItem(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ tags: ["Cat", "小猫"] }) }),
      ctx(id),
    );
    expect(((await patched.json()) as LibraryMedia).tags).toEqual(["cat", "小猫"]);
    const file = await libraryFile(
      new Request("http://x?file=media", { headers: { range: "bytes=0-3" } }),
      ctx(id),
    );
    expect(file.status).toBe(206);
    expect((await removeItem(new Request("http://x", { method: "DELETE" }), ctx(id))).status).toBe(204);
    expect(await (await listLibrary()).json()).toEqual([]);
  });
});
