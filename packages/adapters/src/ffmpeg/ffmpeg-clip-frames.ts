import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ClipFramesPort, DetectCutsOptions, GrabFramesOptions } from "@studio/services";

import { runTool, runToolForStderr } from "./run-tool";

export interface FfmpegClipFramesOptions {
  ffmpegPath?: string;
  /** Per ffmpeg run; finding cuts decodes the whole clip, a few minutes of 4K included. */
  timeoutMs?: number;
}

/**
 * Tried on five real downloaded shorts (docs/plans/clip-analysis.md, P2): at 5, 23/24 and 19/21 hand-counted
 * cuts were found; at 10 only half. A false cut only adds a short shot, a missed one hides a whole scene.
 */
export const DEFAULT_CUT_THRESHOLD = 5;

/**
 * Frames compared per second. Shorts change scenes with fades, which spread the change over many frames, so
 * neighbouring frames at 30fps barely differ (scores under 6); frames 250ms apart catch the whole fade.
 */
const DETECT_FPS = 4;

/** Width the clip is shrunk to before finding cuts: far faster, and a cut is just as visible. */
const DETECT_WIDTH = 320;

const SCD_TIME = /lavfi\.scd\.time:\s*([\d.]+)/gu;

/** Cut times in ms from the `scdet` report ffmpeg prints on stderr (the first frame after the cut). */
export function parseSceneCuts(stderr: string): number[] {
  const cuts = [...stderr.matchAll(SCD_TIME)].map((match) => Math.round(Number(match[1]) * 1000));
  return [...new Set(cuts.filter((ms) => Number.isFinite(ms)))].sort((a, b) => a - b);
}

/** Finds cuts with ffmpeg's `scdet` filter and grabs stills with a fast seek. */
export class FfmpegClipFrames implements ClipFramesPort {
  private readonly ffmpegPath: string;
  private readonly timeoutMs: number;

  constructor(options: FfmpegClipFramesOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.timeoutMs = options.timeoutMs ?? 300_000;
  }

  async detectCuts(absoluteInput: string, options: DetectCutsOptions = {}): Promise<number[]> {
    const threshold = options.threshold ?? DEFAULT_CUT_THRESHOLD;
    const stderr = await runToolForStderr(
      this.ffmpegPath,
      [
        // Hardware decoding when there is any (ffmpeg falls back to software), and no decoding of frames
        // nothing refers to: together they halve the time on 4K HEVC phone clips, with the same cuts.
        ...["-hide_banner", "-nostats", "-hwaccel", "auto", "-skip_frame", "noref"],
        ...["-i", absoluteInput, "-an", "-sn"],
        ...[
          "-vf",
          `fps=${String(DETECT_FPS)},scale=${String(DETECT_WIDTH)}:-2,scdet=threshold=${String(threshold)}`,
        ],
        ...["-f", "null", "-"],
      ],
      this.timeoutMs,
    );
    return parseSceneCuts(stderr);
  }

  async grabFrames(
    absoluteInput: string,
    atMs: readonly number[],
    absoluteOutDir: string,
    options: GrabFramesOptions,
  ): Promise<string[]> {
    await mkdir(absoluteOutDir, { recursive: true });
    const side = String(options.maxSide);
    const frames: string[] = [];
    for (const [i, ms] of atMs.entries()) {
      const output = path.join(absoluteOutDir, `frame-${String(i).padStart(3, "0")}.jpg`);
      // Seeking before -i jumps to the nearest keyframe and decodes on to the exact time: fast and exact.
      // No seek at 0, see FfmpegMediaProbe.createThumbnail. ffmpeg applies the rotation flag itself.
      const seek = ms > 0 ? ["-ss", (ms / 1000).toFixed(3)] : [];
      await runTool(
        this.ffmpegPath,
        [
          ...["-v", "error", "-y", ...seek, "-i", absoluteInput, "-frames:v", "1"],
          ...[
            "-vf",
            `scale=w=${side}:h=${side}:force_original_aspect_ratio=decrease:out_range=full,format=yuvj420p`,
          ],
          ...["-q:v", "3", output],
        ],
        this.timeoutMs,
      );
      // Seeking past the last frame exits 0 without writing anything.
      const written = await stat(output).catch(() => null);
      if (!written || written.size === 0) {
        throw new Error(`ffmpeg wrote no frame at ${String(ms)}ms of ${absoluteInput}`);
      }
      frames.push(output);
    }
    return frames;
  }
}
