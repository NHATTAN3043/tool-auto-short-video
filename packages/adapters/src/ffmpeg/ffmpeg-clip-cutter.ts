import { rename, rm, stat } from "node:fs/promises";

import type { ClipCutterPort, ClipRange } from "@studio/services";

import { runTool } from "./run-tool";

export interface FfmpegClipCutterOptions {
  ffmpegPath?: string;
  /** Per clip; a scene clip is short, but a slow disk should not fail the export. */
  timeoutMs?: number;
}

/**
 * Cuts scene clips out of a rendered MP4. Re-encodes (H.264 CRF 18, near-lossless for a source that is
 * already compressed) because copying streams can only cut on keyframes and would shift scene borders.
 */
export class FfmpegClipCutter implements ClipCutterPort {
  private readonly ffmpegPath: string;
  private readonly timeoutMs: number;

  constructor(options: FfmpegClipCutterOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.timeoutMs = options.timeoutMs ?? 300_000;
  }

  async cut(absoluteInput: string, absoluteOutput: string, range: ClipRange): Promise<void> {
    if (!(range.endMs > range.startMs) || range.startMs < 0) {
      throw new Error(`Invalid clip range ${String(range.startMs)}..${String(range.endMs)}`);
    }
    const partial = absoluteOutput.replace(/\.mp4$/u, ".partial.mp4");
    if (partial === absoluteOutput) throw new Error(`Clip output must be an .mp4 file: ${absoluteOutput}`);
    try {
      await runTool(
        this.ffmpegPath,
        [
          ...["-v", "error", "-y"],
          // Seeking after -i decodes from the start: slower, but exact to the frame.
          ...["-i", absoluteInput],
          ...[
            "-ss",
            (range.startMs / 1000).toFixed(3),
            "-t",
            ((range.endMs - range.startMs) / 1000).toFixed(3),
          ],
          ...["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"],
          ...["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"],
          ...["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
          partial,
        ],
        this.timeoutMs,
      );
      const written = await stat(partial).catch(() => null);
      if (!written || written.size === 0) throw new Error("ffmpeg produced no clip");
      await rename(partial, absoluteOutput);
    } finally {
      await rm(partial, { force: true });
    }
  }
}
