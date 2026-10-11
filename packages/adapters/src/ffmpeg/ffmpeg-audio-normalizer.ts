import { rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { AudioNormalizerPort } from "@studio/services";
import { z } from "zod";

import { runTool, runToolForStderr } from "./run-tool";

export interface FfmpegAudioNormalizerOptions {
  ffmpegPath?: string;
  /** Per ffmpeg run; a scene voice is a few seconds long. */
  timeoutMs?: number;
}

/** Every scene voice is brought to −16 LUFS integrated (EBU R128), peaks held under −1.5 dBFS (ADR 0011). */
export const TARGET_LUFS = -16;
/** Close enough: below what a listener notices between two scenes. */
const TOLERANCE_LU = 0.5;
/** Never amplify a near-silent file by more than this; it would only raise noise. */
const MAX_GAIN_DB = 24;
/**
 * Holds the few sharp peaks (plosives) under −1.5 dBFS so a quiet but peaky voice can still reach the target
 * without clipping. Speech that has no such peaks is not touched by it.
 */
const LIMITER = "alimiter=limit=0.84:attack=5:release=50:level=disabled";

/** The JSON block `loudnorm=…:print_format=json` writes at the end of stderr; numbers come as strings. */
const MeasurementSchema = z.object({ input_i: z.string(), input_tp: z.string() });

/** Integrated loudness (LUFS) from an ffmpeg `loudnorm` report. */
export function parseLoudnormReport(stderr: string): number {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("ffmpeg printed no loudness measurement");
  const integrated = Number(MeasurementSchema.parse(JSON.parse(stderr.slice(start, end + 1))).input_i);
  // Silence measures as -inf: there is nothing to level.
  if (!Number.isFinite(integrated)) throw new Error("The voice is silent; nothing to normalize");
  return integrated;
}

/** Gain plus peak limiter for one encode. */
export function levelFilter(gainDb: number): string {
  const clamped = Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, gainDb));
  return `volume=${clamped.toFixed(2)}dB,${LIMITER}`;
}

/**
 * Evens out the loudness of a speech file: measure it, apply the gain to −16 LUFS with a peak limiter,
 * measure the result and correct once more when the limiter took more than 0.5 LU away. Plain `loudnorm`
 * cannot do this for short, peaky TTS clips: in linear mode the true-peak limit caps its gain (a −24.7 LUFS
 * clip with −4.4 dBTP peaks ends at −21.8), in dynamic mode 2–3 s are too short for it to settle.
 * Re-encoded as MP3 44.1 kHz 128 kbit/s through a `.partial` sibling; the input is never touched.
 */
export class FfmpegAudioNormalizer implements AudioNormalizerPort {
  private readonly ffmpegPath: string;
  private readonly timeoutMs: number;

  constructor(options: FfmpegAudioNormalizerOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? "ffmpeg";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async normalize(absoluteInput: string, absoluteOutput: string): Promise<void> {
    if (path.extname(absoluteOutput).toLowerCase() !== ".mp3") {
      throw new Error(`Normalized voice must be an .mp3 file: ${absoluteOutput}`);
    }
    if (path.resolve(absoluteInput) === path.resolve(absoluteOutput)) {
      throw new Error("Normalizing writes a new file; input and output must differ");
    }
    const partial = absoluteOutput.replace(/\.mp3$/iu, ".partial.mp3");
    try {
      let gain = TARGET_LUFS - (await this.measure(absoluteInput));
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await this.encode(absoluteInput, partial, gain);
        const reached = await this.measure(partial);
        if (Math.abs(reached - TARGET_LUFS) <= TOLERANCE_LU) break;
        gain += TARGET_LUFS - reached;
      }
      const written = await stat(partial).catch(() => null);
      if (!written || written.size === 0) throw new Error("ffmpeg produced no audio");
      await rename(partial, absoluteOutput);
    } finally {
      await rm(partial, { force: true });
    }
  }

  private async measure(file: string): Promise<number> {
    const report = await runToolForStderr(
      this.ffmpegPath,
      ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "loudnorm=print_format=json", "-f", "null", "-"],
      this.timeoutMs,
    );
    return parseLoudnormReport(report);
  }

  private async encode(input: string, output: string, gainDb: number): Promise<void> {
    await runTool(
      this.ffmpegPath,
      [
        ...["-v", "error", "-y", "-i", input],
        ...["-vn", "-af", levelFilter(gainDb)],
        ...["-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k"],
        output,
      ],
      this.timeoutMs,
    );
  }
}
