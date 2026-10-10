import { stat } from "node:fs/promises";

import type { MediaProbePort, ProbeResult, ThumbnailOptions } from "@studio/services";

import { FfprobeOutputSchema, interpretProbe } from "./ffprobe-output";
import { runTool } from "./run-tool";

export interface FfmpegOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
}

/** Probe and thumbnail via the ffprobe/ffmpeg binaries (STUDIO_FFMPEG_PATH / STUDIO_FFPROBE_PATH). */
export class FfmpegMediaProbe implements MediaProbePort {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly timeoutMs: number;

  constructor(options: FfmpegOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.ffprobePath = options.ffprobePath ?? "ffprobe";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async probe(absolutePath: string): Promise<ProbeResult> {
    const stdout = await this.run(this.ffprobePath, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      absolutePath,
    ]);
    return interpretProbe(FfprobeOutputSchema.parse(JSON.parse(stdout)));
  }

  async createThumbnail(
    absoluteInput: string,
    absoluteOutput: string,
    options: ThumbnailOptions,
  ): Promise<void> {
    // ffmpeg applies the rotation flag while decoding, so phone videos come out upright.
    await this.run(this.ffmpegPath, [
      "-v",
      "error",
      "-y",
      "-ss",
      (options.atMs / 1000).toFixed(3),
      "-i",
      absoluteInput,
      "-frames:v",
      "1",
      "-vf",
      // Recent ffmpeg refuses to encode JPEG from limited-range video, so convert to full range first.
      `scale=${String(options.width)}:-2:out_range=full,format=yuvj420p`,
      "-q:v",
      "3",
      absoluteOutput,
    ]);
    // Seeking past the last frame exits 0 without writing anything.
    const written = await stat(absoluteOutput).catch(() => null);
    if (!written || written.size === 0) throw new Error("ffmpeg produced no thumbnail");
  }

  private run(command: string, args: string[]): Promise<string> {
    return runTool(command, args, this.timeoutMs);
  }
}
