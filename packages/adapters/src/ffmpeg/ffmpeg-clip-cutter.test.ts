import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FfmpegClipCutter } from "./ffmpeg-clip-cutter";
import { FfmpegMediaProbe } from "./ffmpeg-media-probe";
import { ffmpegPath, ffprobePath, hasFfmpeg, makeVideo } from "./test-media";

describe.runIf(hasFfmpeg)("FfmpegClipCutter", () => {
  let dir = "";
  let source = "";
  const cutter = new FfmpegClipCutter({ ffmpegPath });
  const probe = new FfmpegMediaProbe({ ffmpegPath, ffprobePath });

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-cut-"));
    source = makeVideo(dir);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("cuts the requested range, frame-accurate, keeping picture and sound", async () => {
    const out = path.join(dir, "clip.mp4");
    await cutter.cut(source, out, { startMs: 1000, endMs: 2500 });
    const result = await probe.probe(out);
    expect(result).toMatchObject({ kind: "video", width: 1280, height: 720, hasAudio: true, codec: "h264" });
    expect(result.durationMs).toBeGreaterThanOrEqual(1450);
    expect(result.durationMs).toBeLessThanOrEqual(1600);
    expect(readdirSync(dir).some((name) => name.includes(".partial."))).toBe(false);
  });

  it("rejects an empty range and leaves nothing behind when ffmpeg fails", async () => {
    await expect(cutter.cut(source, path.join(dir, "x.mp4"), { startMs: 500, endMs: 500 })).rejects.toThrow();
    const out = path.join(dir, "missing.mp4");
    await expect(cutter.cut(path.join(dir, "nope.mp4"), out, { startMs: 0, endMs: 1000 })).rejects.toThrow(
      /ffmpeg/u,
    );
    expect(existsSync(out)).toBe(false);
  });
});
