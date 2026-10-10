import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Test-only helpers: media is generated with `ffmpeg -f lavfi`, never committed to the repo.

export const ffmpegPath = process.env.STUDIO_FFMPEG_PATH || "ffmpeg";
export const ffprobePath = process.env.STUDIO_FFPROBE_PATH || "ffprobe";

function available(binary: string): boolean {
  return spawnSync(binary, ["-version"], { windowsHide: true }).status === 0;
}

export const hasFfmpeg = available(ffmpegPath) && available(ffprobePath);

if (!hasFfmpeg) {
  if (process.env.CI) throw new Error("ffmpeg/ffprobe are required in CI");
  console.warn("ffmpeg/ffprobe not found: skipping media integration tests");
}

function ffmpeg(...args: string[]): void {
  execFileSync(ffmpegPath, ["-v", "error", "-y", ...args], { windowsHide: true });
}

/** 1280×720, 30fps, 3s H.264 with a sine tone. */
export function makeVideo(dir: string, name = "landscape.mp4"): string {
  const out = path.join(dir, name);
  ffmpeg(
    ...["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3"],
    ...["-f", "lavfi", "-i", "sine=frequency=440:duration=3"],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out],
  );
  return out;
}

/** Same pixels as a phone recording: 1280×720 stored, flagged to be displayed rotated by 90°. */
export function makeRotatedVideo(dir: string): string {
  const plain = makeVideo(dir, "rotated-source.mp4");
  const out = path.join(dir, "portrait.mp4");
  ffmpeg("-display_rotation:v:0", "90", "-i", plain, "-c", "copy", out);
  return out;
}

export function makeImage(dir: string, name = "still.png"): string {
  const out = path.join(dir, name);
  ffmpeg("-f", "lavfi", "-i", "testsrc2=size=640x480", "-frames:v", "1", out);
  return out;
}

export function makeMp3(dir: string): string {
  const out = path.join(dir, "voice.mp3");
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=2", "-c:a", "libmp3lame", out);
  return out;
}

export function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
