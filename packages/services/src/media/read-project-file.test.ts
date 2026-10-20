import { createProject } from "@studio/domain";
import { describe, expect, it } from "vitest";

import { InMemoryProjectRepository, InMemoryStorage, oneChunk } from "../testing";
import { makeReadProjectFile } from "./read-project-file";

async function setup() {
  const repo = new InMemoryProjectRepository();
  const storage = new InMemoryStorage();
  await repo.save(createProject({ name: "P", mode: "manual" }, { newId: () => "prj_1" }));
  await storage.write("projects/prj_1/media/ast_1.mp4", oneChunk(new TextEncoder().encode("0123456789")));
  await storage.write("projects/prj_1/thumbnails/empty.jpg", oneChunk(new Uint8Array()));
  await storage.write("projects/prj_1/project.json", oneChunk(new TextEncoder().encode("{}")));
  await storage.write("projects/prj_1/render/out.mp4", oneChunk(new Uint8Array([1])));
  await storage.write("projects/prj_1/voice-previews/abc.mp3", oneChunk(new Uint8Array([1, 2])));
  await storage.write("secret.txt", oneChunk(new TextEncoder().encode("secret")));
  return makeReadProjectFile({ repo, storage });
}

async function text(body: AsyncIterable<Uint8Array>): Promise<string> {
  let out = "";
  for await (const chunk of body) out += new TextDecoder().decode(chunk);
  return out;
}

describe("readProjectFile", () => {
  it("serves the whole file with its content type", async () => {
    const read = await setup();
    const result = await read({ projectId: "prj_1", path: ["media", "ast_1.mp4"] });
    expect(result).toMatchObject({
      status: 200,
      contentType: "video/mp4",
      immutable: true,
      size: 10,
      start: 0,
      end: 9,
    });
    if (result.status === 416) throw new Error("unexpected");
    expect(await text(result.body)).toBe("0123456789");
  });

  it("serves a byte range for seeking", async () => {
    const read = await setup();
    const result = await read({ projectId: "prj_1", path: ["media", "ast_1.mp4"], range: "bytes=2-5" });
    expect(result).toMatchObject({ status: 206, size: 10, start: 2, end: 5 });
    if (result.status === 416) throw new Error("unexpected");
    expect(await text(result.body)).toBe("2345");
  });

  it("marks renders as changeable", async () => {
    const read = await setup();
    expect(await read({ projectId: "prj_1", path: ["render", "out.mp4"] })).toMatchObject({
      status: 200,
      immutable: false,
    });
  });

  it("serves voice previews as audio", async () => {
    const read = await setup();
    expect(await read({ projectId: "prj_1", path: ["voice-previews", "abc.mp3"] })).toMatchObject({
      status: 200,
      contentType: "audio/mpeg",
      immutable: true,
      size: 2,
    });
  });

  it("reports an unsatisfiable range as 416", async () => {
    const read = await setup();
    expect(await read({ projectId: "prj_1", path: ["media", "ast_1.mp4"], range: "bytes=20-" })).toEqual({
      status: 416,
      size: 10,
    });
  });

  it("serves an empty file", async () => {
    const read = await setup();
    const result = await read({ projectId: "prj_1", path: ["thumbnails", "empty.jpg"] });
    expect(result).toMatchObject({ status: 200, size: 0 });
    if (result.status === 416) throw new Error("unexpected");
    expect(await text(result.body)).toBe("");
  });

  it.each([
    ["parent directory", ["media", "..", "..", "secret.txt"]],
    ["dot segment", [".", "media", "ast_1.mp4"]],
    ["encoded parent kept literal", ["media", "%2e%2e", "secret.txt"]],
    ["backslash", ["media", "..\\..\\secret.txt"]],
    ["backslash inside a file name", ["media", "sub\\ast_1.mp4"]],
    ["slash inside a segment", ["media", "../../secret.txt"]],
    ["drive letter", ["media", "C:", "Windows"]],
    ["NUL byte", ["media", "ast_1.mp4\0.jpg"]],
    ["empty segment", ["media", "", "ast_1.mp4"]],
    ["project.json is private", ["project.json"]],
    ["folder outside the served list", ["render-cache", "x.mp4"]],
    ["folder only", ["media"]],
    ["missing file", ["media", "nope.mp4"]],
  ])("rejects %s as not found", async (_label, segments) => {
    const read = await setup();
    await expect(read({ projectId: "prj_1", path: segments })).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });
  });

  it.each(["prj_x", "..", "../prj_1"])("rejects project id %j as not found", async (projectId) => {
    const read = await setup();
    await expect(read({ projectId, path: ["media", "ast_1.mp4"] })).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });
  });
});
