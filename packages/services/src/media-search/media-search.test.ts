import {
  assignMedia,
  createProject,
  DEFAULT_WATERMARK,
  MODE_PRESETS,
  scriptToScenes,
  uploadSourceRef,
  type LibraryMedia,
  type MediaCandidate,
} from "@studio/domain";
import { describe, expect, it } from "vitest";

import {
  FakeClock,
  FakeMediaProbe,
  FakeMediaSearch,
  FakeRemoteFiles,
  InMemoryMediaLibrary,
  InMemoryProjectRepository,
  InMemoryStorage,
  oneChunk,
} from "../testing";
import { makeResolveRankImages } from "../ai/rank-images";
import { makeImportCandidate } from "./import-candidate";
import { makeReadLibraryMediaFile, makeRemoveLibraryMedia, makeSetLibraryMediaTags } from "./media-library";
import { makeProxyStockMedia } from "./proxy-stock-media";
import { makeSearchMedia } from "./search-media";

const stock = (provider: "pexels" | "pixabay", ref: string, width = 1080, height = 1920): MediaCandidate => ({
  provider,
  ref,
  kind: "video",
  width,
  height,
  durationMs: 8000,
  thumbnail: { type: "remote", url: `https://cdn.${provider}.test/${ref}.jpg` },
  preview: { type: "remote", url: `https://cdn.${provider}.test/${ref}-small.mp4` },
});

async function setup(mode: "manual" | "assisted" = "assisted") {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  const probe = new FakeMediaProbe(storage);
  const library = new InMemoryMediaLibrary();
  const remote = new FakeRemoteFiles();
  const pexels = new FakeMediaSearch("pexels");
  const pixabay = new FakeMediaSearch("pixabay");
  pexels.results = [stock("pexels", "p1", 1920, 1080), stock("pexels", "p2")];
  pixabay.results = [stock("pixabay", "x1")];
  const clock = new FakeClock("2026-10-10T00:00:00.000Z");
  let n = 0;
  const newId = (prefix: string) => `${prefix}_${String(++n)}`;
  await repo.save({
    ...createProject({ name: "P", mode }, { newId: () => "prj_1" }),
    automationSettings: { ...MODE_PRESETS[mode] },
    scenes: scriptToScenes(
      "Một.\n\nHai.\n\nBa.\n\nBốn.\n\nNăm.",
      {},
      { newId: (p) => `${p}_s${String(++n)}` },
    ),
  });
  const providers = [pexels, pixabay];
  return {
    repo,
    storage,
    probe,
    library,
    remote,
    pexels,
    pixabay,
    search: makeSearchMedia({ repo, library, providers }),
    importCandidate: makeImportCandidate({ repo, library, providers, storage, probe, remote, clock, newId }),
  };
}

const query = {
  query: "cat",
  kind: "video" as const,
  lang: "en" as const,
  sources: ["library", "pexels", "pixabay"] as ("library" | "pexels" | "pixabay")[],
};

describe("searchMedia", () => {
  it("searches stock providers in the asked language, portrait first, alternating providers", async () => {
    const s = await setup();
    const result = await s.search({ projectId: "prj_1", query: { ...query, lang: "zh", query: "小猫" } });
    expect(result.candidates.map((c) => c.ref)).toEqual(["p2", "x1", "p1"]);
    expect(result.stockProviders).toEqual(["pexels", "pixabay"]);
    expect(s.pexels.searches[0]).toMatchObject({ query: "小猫", lang: "zh", kind: "video" });
  });

  it("only searches the library in a project whose mediaSearch toggle is off", async () => {
    const s = await setup("manual");
    const result = await s.search({ projectId: "prj_1", query });
    expect(result).toEqual({ candidates: [], errors: [], stockProviders: [] });
    expect(s.pexels.searches).toEqual([]);
  });

  it("keeps results of the other sources when one provider fails", async () => {
    const s = await setup();
    s.pexels.fail = true;
    const result = await s.search({ projectId: "prj_1", query });
    expect(result.candidates.map((c) => c.ref)).toEqual(["x1"]);
    expect(result.errors).toEqual([{ provider: "pexels", message: "pexels is down" }]);
  });

  it("offers the project's own uploads first, by the tags in their file names, and imports them as is", async () => {
    const s = await setup("manual");
    const upload = (id: string, fileName: string, source: "upload" | "pexels" = "upload") => ({
      id,
      kind: "video" as const,
      source,
      fileName,
      path: `media/${id}.mp4`,
      thumbnailPath: `thumbnails/${id}.jpg`,
      width: 1080,
      height: 1920,
      createdAt: "2026-10-10T00:00:00.000Z",
    });
    await s.repo.update("prj_1", (project) => ({
      ...project,
      assets: [
        upload("ast_cat", "orange-cat__sofa.mp4"),
        upload("ast_dog", "dog-running__beach.mp4"),
        upload("ast_stock", "pexels-cat.mp4", "pexels"),
      ],
    }));
    const result = await s.search({
      projectId: "prj_1",
      query: { ...query, query: "orange cat", sources: ["project", "library", "pexels", "pixabay"] },
    });
    expect(result.candidates).toEqual([
      {
        provider: "project",
        ref: "ast_cat",
        kind: "video",
        width: 1080,
        height: 1920,
        thumbnail: {
          type: "project",
          projectId: "prj_1",
          assetId: "ast_cat",
          path: "thumbnails/ast_cat.jpg",
        },
        preview: { type: "project", projectId: "prj_1", assetId: "ast_cat", path: "media/ast_cat.mp4" },
        description: "orange cat, sofa",
      },
    ]);

    const before = await s.repo.get("prj_1");
    const picked = await s.importCandidate({
      projectId: "prj_1",
      candidate: { provider: "project", ref: "ast_cat", kind: "video" },
      query: "orange cat",
    });
    expect(picked.asset.id).toBe("ast_cat");
    expect((await s.repo.get("prj_1")).assets).toEqual(before.assets);
    await expect(
      s.importCandidate({
        projectId: "prj_1",
        candidate: { provider: "project", ref: "ast_missing", kind: "video" },
        query: "x",
      }),
    ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
  });

  it("offers a video that is both in the project and in the library once (ADR 0019)", async () => {
    const s = await setup("manual");
    await s.repo.update("prj_1", (project) => ({
      ...project,
      assets: [
        {
          id: "ast_cat",
          kind: "video",
          source: "upload",
          fileName: "orange-cat__sofa.mp4",
          path: "media/ast_cat.mp4",
          contentHash: "sha256:cat",
          width: 1080,
          height: 1920,
          createdAt: "2026-10-10T00:00:00.000Z",
        },
      ],
    }));
    const twin: LibraryMedia = {
      id: "lib_cat",
      kind: "video",
      fileName: "orange-cat__sofa.mp4",
      path: "files/lib_cat.mp4",
      tags: ["orange cat", "sofa"],
      usageCount: 0,
      source: "upload",
      sourceRef: uploadSourceRef("sha256:cat"),
      contentHash: "sha256:cat",
      createdAt: "2026-10-10T00:00:00.000Z",
    };
    await s.library.add(twin);
    const own = { ...query, query: "orange cat", sources: ["project" as const, "library" as const] };
    const refs = async () =>
      (await s.search({ projectId: "prj_1", query: own })).candidates.map((c) => `${c.provider}:${c.ref}`);

    // Not analyzed yet: the project file, which needs no copy.
    expect(await refs()).toEqual(["project:ast_cat"]);

    // Analyzed: the library item, whose shots describe the clip.
    s.library.items.set("lib_cat", {
      ...twin,
      analysis: {
        shots: [
          {
            index: 0,
            startMs: 0,
            endMs: 3000,
            description: "Orange cat",
            tags: ["orange cat"],
            textOverlay: false,
          },
        ],
        model: "claude-sonnet-5-5",
        analyzedAt: "2026-10-10T00:00:00.000Z",
      },
    });
    expect(await refs()).toEqual(["library:lib_cat"]);
  });

  it("offers the best shots of an analyzed clip, at most three per clip, and starts the scene at the shot", async () => {
    const s = await setup("manual");
    const shots = Array.from({ length: 5 }, (_, index) => ({
      index,
      startMs: index * 2000,
      endMs: (index + 1) * 2000,
      description: index === 4 ? "A dog running" : "A cat sleeping",
      tags: index === 4 ? ["dog"] : ["cat sleeping"],
      textOverlay: index === 1,
    }));
    await s.library.add({
      id: "lib_clip",
      kind: "video",
      fileName: "7389101112.mp4",
      path: "files/lib_clip.mp4",
      durationMs: 10_000,
      width: 1080,
      height: 1920,
      tags: ["7389101112"],
      usageCount: 0,
      source: "upload",
      sourceRef: uploadSourceRef("sha256:clip"),
      contentHash: "sha256:clip",
      analysis: { shots, model: "m", analyzedAt: "2026-10-10T00:00:00.000Z" },
      createdAt: "2026-10-10T00:00:00.000Z",
    });
    await s.storage.write("library/media/files/lib_clip.mp4", oneChunk(new Uint8Array([1])));
    const result = await s.search({
      projectId: "prj_1",
      query: { ...query, query: "cat sleeping", sources: ["library"] },
    });

    // Four shots match; the three best are offered, the one with text after the clean ones.
    expect(result.candidates.map((c) => c.segment?.index)).toEqual([0, 2, 3]);
    expect(result.candidates[0]).toEqual({
      provider: "library",
      ref: "lib_clip",
      kind: "video",
      width: 1080,
      height: 1920,
      durationMs: 2000,
      thumbnail: { type: "library", id: "lib_clip", file: "shot", shot: 0 },
      preview: { type: "library", id: "lib_clip", file: "media" },
      segment: { index: 0, startMs: 0, endMs: 2000 },
      description: "A cat sleeping · cat sleeping",
    });

    const picked = await s.importCandidate({
      projectId: "prj_1",
      candidate: { provider: "library", ref: "lib_clip", kind: "video", segmentIndex: 3 },
      query: "cat sleeping",
    });
    expect(picked.startMs).toBe(6000);
    const again = await s.importCandidate({
      projectId: "prj_1",
      candidate: { provider: "library", ref: "lib_clip", kind: "video", segmentIndex: 0 },
      query: "cat sleeping",
    });
    expect(again.asset.id).toBe(picked.asset.id);
    expect(again.startMs).toBe(0);
    await expect(
      s.importCandidate({
        projectId: "prj_1",
        candidate: { provider: "library", ref: "lib_clip", kind: "video", segmentIndex: 9 },
        query: "x",
      }),
    ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
  });

  it("sends the still of a shot, not the clip's thumbnail, to vision ranking", async () => {
    const s = await setup("manual");
    await s.library.add({
      id: "lib_clip",
      kind: "video",
      fileName: "a.mp4",
      path: "files/lib_clip.mp4",
      thumbnailPath: "thumbnails/lib_clip.jpg",
      tags: [],
      usageCount: 0,
      source: "upload",
      sourceRef: uploadSourceRef("sha256:clip"),
      contentHash: "sha256:clip",
      analysis: {
        shots: [
          {
            index: 0,
            startMs: 0,
            endMs: 2000,
            description: "",
            tags: [],
            textOverlay: false,
            thumbnailPath: "shots/lib_clip/j/frame-000.jpg",
          },
        ],
        model: "m",
        analyzedAt: "2026-10-10T00:00:00.000Z",
      },
      createdAt: "2026-10-10T00:00:00.000Z",
    });
    await s.storage.write("library/media/thumbnails/lib_clip.jpg", oneChunk(new Uint8Array([1])));
    await s.storage.write("library/media/shots/lib_clip/j/frame-000.jpg", oneChunk(new Uint8Array([2, 2])));
    const images = await makeResolveRankImages({
      library: s.library,
      repo: s.repo,
      storage: s.storage,
      providers: [],
    })({
      mode: "vision",
      scenes: [
        {
          sceneId: "s1",
          narration: "Mèo.",
          candidates: [
            {
              key: "library:video:lib_clip#0",
              kind: "video",
              width: 1080,
              height: 1920,
              thumbnail: { type: "library", id: "lib_clip", file: "shot", shot: 0 },
            },
          ],
        },
      ],
    });
    expect(images.get("library:video:lib_clip#0")).toEqual({
      type: "base64",
      mediaType: "image/jpeg",
      data: btoa("\u0002\u0002"),
    });
  });

  it("never offers the channel logo as a scene's picture", async () => {
    const s = await setup("manual");
    const image = (id: string, fileName: string) => ({
      id,
      kind: "image" as const,
      source: "upload" as const,
      fileName,
      path: `media/${id}.png`,
      createdAt: "2026-10-10T00:00:00.000Z",
    });
    await s.repo.update("prj_1", (project) => ({
      ...project,
      assets: [image("ast_logo", "cat-channel__logo.png"), image("ast_cat", "cat__sofa.png")],
      style: { ...project.style, watermark: { ...DEFAULT_WATERMARK, assetId: "ast_logo" } },
    }));
    const result = await s.search({
      projectId: "prj_1",
      query: { ...query, kind: "image", sources: ["project"] },
    });
    expect(result.candidates.map((candidate) => candidate.ref)).toEqual(["ast_cat"]);
  });
});

describe("importCandidate", () => {
  it("downloads a stock clip once into the library, copies it into the project, and counts the use", async () => {
    const s = await setup();
    const { asset, project } = await s.importCandidate({
      projectId: "prj_1",
      candidate: { provider: "pexels", ref: "p2", kind: "video" },
      query: "Mèo Con",
    });
    expect(asset).toMatchObject({ kind: "video", source: "pexels", durationMs: 12_000, hasAudio: true });
    expect(project.assets).toEqual([asset]);
    const [item] = await s.library.list();
    expect(item).toMatchObject({ sourceRef: "pexels:video:p2", tags: ["mèo con"], usageCount: 1 });
    expect(s.storage.files.has(`library/media/${item?.path ?? ""}`)).toBe(true);
    expect(s.storage.files.has(`projects/prj_1/${asset.path}`)).toBe(true);

    // The same clip found again: no second download, and it now shows as a library candidate.
    const again = await s.search({ projectId: "prj_1", query: { ...query, query: "mèo con" } });
    expect(again.candidates[0]).toMatchObject({ provider: "library", ref: item?.id });
    expect(again.candidates.some((c) => c.ref === "p2")).toBe(false);
    const reused = await s.importCandidate({
      projectId: "prj_1",
      candidate: { provider: "pexels", ref: "p2", kind: "video" },
      query: "cat",
    });
    expect(reused.asset.id).toBe(asset.id);
    expect(s.remote.opened).toHaveLength(1);
  });

  it("copies a library item into another project and counts that use", async () => {
    const s = await setup();
    await s.importCandidate({
      projectId: "prj_1",
      candidate: { provider: "pixabay", ref: "x1", kind: "video" },
      query: "dog",
    });
    const [item] = await s.library.list();
    await s.repo.save({ ...(await s.repo.get("prj_1")), id: "prj_2", assets: [] });
    const { asset } = await s.importCandidate({
      projectId: "prj_2",
      candidate: { provider: "library", ref: item?.id ?? "", kind: "video" },
      query: "dog",
    });
    expect(asset.source).toBe("pixabay");
    expect((await s.library.get(item?.id ?? "")).usageCount).toBe(2);
  });

  it("assigning the imported clip to scene 5 changes only scene 5 (M10 acceptance)", async () => {
    const s = await setup();
    const before = await s.repo.get("prj_1");
    const { asset, project } = await s.importCandidate({
      projectId: "prj_1",
      candidate: { provider: "pexels", ref: "p2", kind: "video" },
      query: "cat",
    });
    const fifth = project.scenes[4]?.id ?? "";
    const after = assignMedia(project, fifth, { assetId: asset.id });
    after.scenes.forEach((scene, index) => {
      if (index === 4) expect(scene.media?.assetId).toBe(asset.id);
      else expect(scene).toEqual(before.scenes[index]);
    });
  });

  it("refuses stock imports when the toggle is off and cleans up failed downloads", async () => {
    const manual = await setup("manual");
    await expect(
      manual.importCandidate({
        projectId: "prj_1",
        candidate: { provider: "pexels", ref: "p2", kind: "video" },
        query: "x",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });

    const s = await setup();
    s.probe.failProbe = true;
    await expect(
      s.importCandidate({
        projectId: "prj_1",
        candidate: { provider: "pexels", ref: "p2", kind: "video" },
        query: "x",
      }),
    ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
    expect(s.storage.files.size).toBe(0);
    expect(await s.library.list()).toEqual([]);

    const missing = await setup();
    await expect(
      missing.importCandidate({
        projectId: "prj_1",
        candidate: { provider: "pexels", ref: "missing", kind: "video" },
        query: "x",
      }),
    ).rejects.toMatchObject({ code: "MEDIA_SEARCH_FAILED" });
  });
});

describe("library management and proxy", () => {
  it("edits tags, serves files and removes items with their files", async () => {
    const s = await setup();
    await s.importCandidate({
      projectId: "prj_1",
      candidate: { provider: "pexels", ref: "p2", kind: "video" },
      query: "cat",
    });
    const [item] = (await s.library.list()) as [LibraryMedia];
    const tagged = await makeSetLibraryMediaTags({ library: s.library })({
      id: item.id,
      tags: [" Mèo ", "mèo", "小猫"],
    });
    expect(tagged.tags).toEqual(["mèo", "小猫"]);

    const read = makeReadLibraryMediaFile({ library: s.library, storage: s.storage });
    expect(await read({ id: item.id, file: "thumbnail" })).toMatchObject({
      status: 200,
      contentType: "image/jpeg",
    });
    expect(await read({ id: item.id, file: "media", range: "bytes=0-1" })).toMatchObject({
      status: 206,
      start: 0,
      end: 1,
    });

    await makeRemoveLibraryMedia({ library: s.library, storage: s.storage })(item.id);
    expect([...s.storage.files.keys()].some((key) => key.startsWith("library/"))).toBe(false);
    // The project keeps its own copy.
    expect([...s.storage.files.keys()].some((key) => key.startsWith("projects/prj_1/media/"))).toBe(true);
  });

  it("proxies only HTTPS URLs on provider media hosts, passing the range through", async () => {
    const s = await setup();
    const proxy = makeProxyStockMedia({ providers: [s.pexels, s.pixabay], remote: s.remote });
    await expect(
      proxy({ url: "https://cdn.pexels.test/p2-small.mp4", range: "bytes=0-" }),
    ).resolves.toMatchObject({
      status: 200,
    });
    expect(s.remote.opened.at(-1)).toEqual({
      url: "https://cdn.pexels.test/p2-small.mp4",
      range: "bytes=0-",
    });
    for (const url of [
      "http://cdn.pexels.test/a.jpg",
      "https://evil.test/a.jpg",
      "https://user:pw@cdn.pexels.test/a.jpg",
      "not a url",
      "https://127.0.0.1/a.jpg",
    ]) {
      await expect(proxy({ url })).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    }
  });
});
