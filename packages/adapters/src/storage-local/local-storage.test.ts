import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalStorage } from "./local-storage";

async function* chunks(...parts: string[]): AsyncIterable<Uint8Array> {
  for (const part of parts) {
    await Promise.resolve();
    yield new TextEncoder().encode(part);
  }
}

async function* failing(): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode("partial");
  await Promise.resolve();
  throw new Error("connection lost");
}

describe("LocalStorage", () => {
  let root = "";
  let storage: LocalStorage;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "studio-storage-"));
    storage = new LocalStorage(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("streams a file, creating directories, and reports size and sha256", async () => {
    const result = await storage.write("projects/prj_1/media/a.txt", chunks("hello ", "world"));
    expect(result).toEqual({
      bytes: 11,
      sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    });
    expect(readFileSync(path.join(root, "projects/prj_1/media/a.txt"), "utf8")).toBe("hello world");
    expect(await storage.exists("projects/prj_1/media/a.txt")).toBe(true);
  });

  it("leaves nothing behind when the stream fails", async () => {
    await expect(storage.write("media/b.txt", failing())).rejects.toThrow("connection lost");
    expect(readdirSync(path.join(root, "media"))).toEqual([]);
  });

  it("removes files and ignores missing ones", async () => {
    await storage.write("x.txt", chunks("x"));
    await storage.remove("x.txt");
    await storage.remove("x.txt");
    expect(await storage.exists("x.txt")).toBe(false);
  });

  it("removes a whole folder and ignores a missing one", async () => {
    await storage.write("tmp/job/a.txt", chunks("a"));
    await storage.write("tmp/job/sub/b.txt", chunks("b"));
    await storage.write("tmp/keep.txt", chunks("k"));
    await storage.removeFolder("tmp/job");
    await storage.removeFolder("tmp/job");
    expect(existsSync(path.join(root, "tmp", "job"))).toBe(false);
    expect(await storage.exists("tmp/keep.txt")).toBe(true);
  });

  it("resolves keys inside the root and prepares parent directories", async () => {
    expect(storage.resolvePath("projects/prj_1/media/a.mp4")).toBe(
      path.join(root, "projects", "prj_1", "media", "a.mp4"),
    );
    const target = await storage.pathForWrite("projects/prj_1/thumbnails/a.jpg");
    expect(existsSync(path.dirname(target))).toBe(true);
  });

  it.each([
    "../outside.txt",
    "projects/../../outside.txt",
    "..\\outside.txt",
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "c:relative",
    "a\0b",
    "",
    ".",
  ])("rejects the escaping key %j", async (key) => {
    expect(() => storage.resolvePath(key)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    await expect(storage.exists(key)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("reports file size and reads whole files or byte ranges", async () => {
    await storage.write("projects/p/media/a.txt", chunks("0123456789"));
    expect(await storage.stat("projects/p/media/a.txt")).toEqual({ size: 10 });
    expect(await storage.stat("projects/p/media")).toBeNull();
    expect(await storage.stat("projects/p/media/missing.txt")).toBeNull();

    const read = async (range?: { start: number; end: number }) => {
      let out = "";
      for await (const chunk of storage.read("projects/p/media/a.txt", range)) {
        out += new TextDecoder().decode(chunk);
      }
      return out;
    };
    expect(await read()).toBe("0123456789");
    expect(await read({ start: 3, end: 6 })).toBe("3456");
  });

  it("rejects escaping keys when reading", async () => {
    await expect(storage.stat("../x")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const iterator = storage.read("../x")[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects a sibling directory that shares the root prefix", () => {
    expect(() => storage.resolvePath(`../${path.basename(root)}-evil/x`)).toThrow();
  });
});
