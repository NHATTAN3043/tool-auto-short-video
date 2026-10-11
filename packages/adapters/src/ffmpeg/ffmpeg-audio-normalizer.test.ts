import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FfmpegAudioNormalizer, levelFilter, parseLoudnormReport } from "./ffmpeg-audio-normalizer";
import { FfmpegMediaProbe } from "./ffmpeg-media-probe";
import { ffmpegPath, ffprobePath, hasFfmpeg, makeMp3, sha256File } from "./test-media";

/** Integrated loudness (LUFS) and sample peak (dBFS), as ffmpeg's ebur128 filter measures them. */
function measure(file: string): { lufs: number; peak: number } {
  const run = spawnSync(
    ffmpegPath,
    ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=sample", "-f", "null", "-"],
    { encoding: "utf8", windowsHide: true },
  );
  const summary = run.stderr.slice(run.stderr.lastIndexOf("Summary:"));
  const lufs = /I:\s+(-?\d+(?:\.\d+)?) LUFS/u.exec(summary)?.[1];
  const peak = /Peak:\s+(-?\d+(?:\.\d+)?) dBFS/u.exec(summary)?.[1];
  if (lufs === undefined || peak === undefined)
    throw new Error(`No ebur128 summary: ${run.stderr.slice(-300)}`);
  return { lufs: Number(lufs), peak: Number(peak) };
}

describe("loudness measurement", () => {
  const report = (inputI: string) =>
    `[Parsed_loudnorm_0 @ 0x1]\n{\n "input_i" : "${inputI}",\n "input_tp" : "-4.4",\n "target_offset" : "0.3"\n}\n`;

  it("reads the integrated loudness and builds a gain with a peak limiter", () => {
    expect(parseLoudnormReport(report("-24.74"))).toBe(-24.74);
    expect(levelFilter(8.74)).toBe("volume=8.74dB,alimiter=limit=0.84:attack=5:release=50:level=disabled");
    expect(levelFilter(60)).toMatch(/^volume=24\.00dB/u);
  });

  it("refuses silence and output without a report", () => {
    expect(() => parseLoudnormReport(report("-inf"))).toThrow(/silent/u);
    expect(() => parseLoudnormReport("no json here")).toThrow(/measurement/u);
  });
});

describe.runIf(hasFfmpeg)("FfmpegAudioNormalizer", () => {
  let dir = "";
  let source = "";
  const normalizer = new FfmpegAudioNormalizer({ ffmpegPath });
  const probe = new FfmpegMediaProbe({ ffmpegPath, ffprobePath });

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "studio-norm-"));
    source = makeMp3(dir);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a new mp3 at about −16 LUFS and leaves the input untouched", async () => {
    const before = sha256File(source);
    const out = path.join(dir, "voice.normalized.mp3");
    await normalizer.normalize(source, out);

    expect(sha256File(source)).toBe(before);
    expect(await probe.probe(out)).toMatchObject({ kind: "audio", codec: "mp3" });
    expect(Math.abs(measure(out).lufs - -16)).toBeLessThanOrEqual(1);
    expect(readdirSync(dir).some((name) => name.includes(".partial."))).toBe(false);
  });

  it("brings a short, quiet clip with sharp peaks to the target without clipping", async () => {
    // Like a TTS line with plosives: low loudness, peaks far above it (loudnorm alone stops ~6 LU short).
    const peaky = path.join(dir, "peaky.mp3");
    execFileSync(
      ffmpegPath,
      [
        ...["-v", "error", "-y", "-f", "lavfi"],
        ...["-i", "aevalsrc=0.03*sin(2*PI*220*t)+0.6*lt(mod(t\\,0.5)\\,0.003):d=2.5:s=44100"],
        peaky,
      ],
      { windowsHide: true },
    );
    const out = path.join(dir, "peaky.normalized.mp3");
    await normalizer.normalize(peaky, out);
    const result = measure(out);
    expect(Math.abs(result.lufs - -16)).toBeLessThanOrEqual(1);
    expect(result.peak).toBeLessThan(0);
  });

  it("refuses to overwrite its input or write another format, and leaves nothing behind on failure", async () => {
    await expect(normalizer.normalize(source, source)).rejects.toThrow(/differ/u);
    await expect(normalizer.normalize(source, path.join(dir, "x.wav"))).rejects.toThrow(/mp3/u);
    await expect(normalizer.normalize(path.join(dir, "nope.mp3"), path.join(dir, "out.mp3"))).rejects.toThrow(
      /ffmpeg/u,
    );
    expect(readdirSync(dir).some((name) => name.includes(".partial.") || name === "out.mp3")).toBe(false);
  });
});
