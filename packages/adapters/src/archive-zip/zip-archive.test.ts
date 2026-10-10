import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZipArchive } from "./zip-archive";

/** Names in the central directory of a ZIP, read straight from the bytes. */
function zipEntryNames(file: string): string[] {
  const bytes = readFileSync(file);
  const names: string[] = [];
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(i + 28);
    names.push(bytes.subarray(i + 46, i + 46 + nameLength).toString("utf8"));
  }
  return names;
}

describe("ZipArchive", () => {
  let dir = "";
  const archive = new ZipArchive();

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-zip-"));
    mkdirSync(path.join(dir, "in"));
    writeFileSync(path.join(dir, "in", "video.mp4"), "video-bytes");
    writeFileSync(path.join(dir, "in", "phu_de.srt"), "1\n00:00:00,000 --> 00:00:01,000\nXin chào\n");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("packs the files under their archive names", async () => {
    const out = path.join(dir, "goi.zip");
    await archive.zip(
      [
        { name: "video_khong_phu_de.mp4", file: path.join(dir, "in", "video.mp4") },
        { name: "canh/canh_01.mp4", file: path.join(dir, "in", "video.mp4") },
        { name: "phu_de.srt", file: path.join(dir, "in", "phu_de.srt") },
      ],
      out,
    );
    expect(readFileSync(out).subarray(0, 2).toString("latin1")).toBe("PK");
    expect(zipEntryNames(out)).toEqual(["video_khong_phu_de.mp4", "canh/canh_01.mp4", "phu_de.srt"]);
    expect(existsSync(`${out}.partial`)).toBe(false);
  });

  it("refuses unsafe or duplicate names and missing files, writing nothing", async () => {
    const out = path.join(dir, "bad.zip");
    const file = path.join(dir, "in", "video.mp4");
    await expect(archive.zip([{ name: "../evil.mp4", file }], out)).rejects.toThrow(/Unsafe/u);
    await expect(archive.zip([{ name: "/abs.mp4", file }], out)).rejects.toThrow(/Unsafe/u);
    await expect(
      archive.zip(
        [
          { name: "a.mp4", file },
          { name: "a.mp4", file },
        ],
        out,
      ),
    ).rejects.toThrow(/Duplicate/u);
    await expect(archive.zip([{ name: "a.mp4", file: path.join(dir, "nope.mp4") }], out)).rejects.toThrow();
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.partial`)).toBe(false);
  });
});
