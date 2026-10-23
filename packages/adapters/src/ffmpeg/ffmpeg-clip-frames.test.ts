import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FfmpegClipFrames, parseSceneCuts } from "./ffmpeg-clip-frames";
import { FfmpegMediaProbe } from "./ffmpeg-media-probe";
import {
  ffmpegPath,
  ffprobePath,
  hasFfmpeg,
  makeRotatedVideo,
  makeShotsVideo,
  makeSingleShotVideo,
} from "./test-media";

/** Cuts are found on frames 250ms apart, so that is the precision of a cut time. */
const SAMPLE_MS = 250;

describe("parseSceneCuts", () => {
  it("reads the scdet times in ms, sorted and without duplicates", () => {
    const stderr = [
      "[Parsed_scdet_1 @ 0x1] lavfi.scd.score: 32.615, lavfi.scd.time: 5",
      "frame=  270 fps=0.0 q=-0.0",
      "[Parsed_scdet_1 @ 0x1] lavfi.scd.score: 15.625, lavfi.scd.time: 2.033333",
      "[Parsed_scdet_1 @ 0x1] lavfi.scd.score: 15.625, lavfi.scd.time: 2.033333",
    ].join("\n");
    expect(parseSceneCuts(stderr)).toEqual([2033, 5000]);
  });

  it("is empty when ffmpeg found no change", () => {
    expect(parseSceneCuts("Input #0, mov,mp4\n  Duration: 00:00:20.00")).toEqual([]);
  });
});

describe.runIf(hasFfmpeg)("FfmpegClipFrames", () => {
  let dir = "";
  let shots = "";
  const frames = new FfmpegClipFrames({ ffmpegPath });
  const probe = new FfmpegMediaProbe({ ffmpegPath, ffprobePath });

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-frames-"));
    shots = makeShotsVideo(dir);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds the scene changes of a clip within one sample", async () => {
    const cuts = await frames.detectCuts(shots);
    expect(cuts).toHaveLength(2);
    expect(Math.abs((cuts[0] ?? 0) - 2000)).toBeLessThanOrEqual(SAMPLE_MS);
    expect(Math.abs((cuts[1] ?? 0) - 5000)).toBeLessThanOrEqual(SAMPLE_MS);
  });

  // Making and decoding the clip takes a few seconds when the whole suite runs at once.
  it("finds no cut in one continuous shot", { timeout: 30_000 }, async () => {
    expect(await frames.detectCuts(makeSingleShotVideo(dir, 12))).toEqual([]);
  });

  it("grabs one small frame per time, in order, inside the longest side", async () => {
    const out = path.join(dir, "frames");
    const written = await frames.grabFrames(shots, [0, 3500, 7000], out, { maxSide: 480 });
    expect(written.map((file) => path.basename(file))).toEqual([
      "frame-000.jpg",
      "frame-001.jpg",
      "frame-002.jpg",
    ]);
    for (const file of written) {
      expect(await probe.probe(file)).toMatchObject({ kind: "image", width: 270, height: 480 });
    }
  });

  it("grabs phone videos upright", async () => {
    const [file] = await frames.grabFrames(makeRotatedVideo(dir), [1000], path.join(dir, "rotated"), {
      maxSide: 480,
    });
    const result = await probe.probe(file ?? "");
    expect(result).toMatchObject({ kind: "image", width: 270, height: 480 });
  });

  it("fails clearly past the end of the clip or on a file that is not a video", async () => {
    await expect(
      frames.grabFrames(shots, [60_000], path.join(dir, "late"), { maxSide: 480 }),
    ).rejects.toThrow(/no frame/u);
    const broken = path.join(dir, "broken.mp4");
    writeFileSync(broken, "not a video");
    await expect(frames.detectCuts(broken)).rejects.toThrow(/ffmpeg/u);
  });
});
