import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FfmpegMediaProbe } from "./ffmpeg-media-probe";
import { interpretProbe } from "./ffprobe-output";
import {
  ffmpegPath,
  ffprobePath,
  hasFfmpeg,
  makeImage,
  makeMp3,
  makeRotatedVideo,
  makeVideo,
} from "./test-media";

describe("interpretProbe", () => {
  it("treats cover art in an mp3 as audio", () => {
    expect(
      interpretProbe({
        streams: [
          { codec_type: "audio", codec_name: "mp3" },
          {
            codec_type: "video",
            codec_name: "mjpeg",
            width: 500,
            height: 500,
            disposition: { attached_pic: 1 },
          },
        ],
        format: { format_name: "mp3", duration: "2.5" },
      }),
    ).toEqual({ kind: "audio", hasAudio: true, durationMs: 2500, codec: "mp3" });
  });

  it("reads the legacy rotate tag and odd frame rates", () => {
    expect(
      interpretProbe({
        streams: [
          {
            codec_type: "video",
            codec_name: "hevc",
            width: 1920,
            height: 1080,
            avg_frame_rate: "30000/1001",
            tags: { rotate: "270" },
          },
        ],
        format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1.0" },
      }),
    ).toEqual({
      kind: "video",
      hasAudio: false,
      width: 1080,
      height: 1920,
      fps: 29.97,
      codec: "hevc",
      durationMs: 1000,
    });
  });

  it("falls back to r_frame_rate and tolerates missing fields", () => {
    expect(
      interpretProbe({ streams: [{ codec_type: "video", avg_frame_rate: "0/0", r_frame_rate: "25/1" }] }),
    ).toEqual({ kind: "video", hasAudio: false, fps: 25 });
  });

  it("rejects a file without media streams", () => {
    expect(() => interpretProbe({ streams: [{ codec_type: "data" }] })).toThrow(
      expect.objectContaining({ code: "INVALID_MEDIA" }),
    );
  });
});

describe.skipIf(!hasFfmpeg)("FfmpegMediaProbe (real ffmpeg)", () => {
  const probe = new FfmpegMediaProbe({ ffmpegPath, ffprobePath });
  let dir = "";
  const files = { video: "", portrait: "", image: "", mp3: "" };

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-ffmpeg-"));
    files.video = makeVideo(dir);
    files.portrait = makeRotatedVideo(dir);
    files.image = makeImage(dir);
    files.mp3 = makeMp3(dir);
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("probes a landscape video with audio", async () => {
    const result = await probe.probe(files.video);
    expect(result).toMatchObject({
      kind: "video",
      width: 1280,
      height: 720,
      fps: 30,
      hasAudio: true,
      codec: "h264",
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(2900);
    expect(result.durationMs).toBeLessThanOrEqual(3100);
  });

  it("swaps width and height for a rotated phone video", async () => {
    expect(await probe.probe(files.portrait)).toMatchObject({ kind: "video", width: 720, height: 1280 });
  });

  it("recognizes a png as an image without duration", async () => {
    const result = await probe.probe(files.image);
    expect(result).toMatchObject({ kind: "image", width: 640, height: 480, hasAudio: false });
    expect(result.durationMs).toBeUndefined();
  });

  it("recognizes an mp3 as audio", async () => {
    const result = await probe.probe(files.mp3);
    expect(result).toMatchObject({ kind: "audio", hasAudio: true, codec: "mp3" });
    expect(result.durationMs).toBeGreaterThan(1900);
  });

  it("creates scaled thumbnails for videos and images", async () => {
    // importAsset seeks 1s into videos and uses the only frame (0) of images.
    for (const [input, name, atMs] of [
      [files.video, "video.jpg", 1000],
      [files.image, "image.jpg", 0],
    ] as const) {
      const out = path.join(dir, name);
      await probe.createThumbnail(input, out, { atMs, width: 360 });
      expect(statSync(out).size).toBeGreaterThan(0);
    }
  });

  it("fails on files that are not media and on seeks past the end", async () => {
    const junk = path.join(dir, "junk.mp4");
    writeFileSync(junk, "not a video");
    await expect(probe.probe(junk)).rejects.toThrow(/ffprobe/u);
    await expect(
      probe.createThumbnail(files.video, path.join(dir, "late.jpg"), { atMs: 60_000, width: 360 }),
    ).rejects.toThrow();
  });
});
