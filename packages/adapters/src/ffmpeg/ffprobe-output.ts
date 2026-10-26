import { DomainError } from "@studio/domain";
import type { ProbeResult } from "@studio/services";
import { z } from "zod";

// Only the fields we read; ffprobe output has many more and they vary by version, hence `loose`.
const StreamSchema = z.looseObject({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  r_frame_rate: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  duration: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  side_data_list: z.array(z.looseObject({ rotation: z.number().optional() })).optional(),
  disposition: z.looseObject({ attached_pic: z.number().optional() }).optional(),
});
type Stream = z.infer<typeof StreamSchema>;

export const FfprobeOutputSchema = z.object({
  streams: z.array(StreamSchema).default([]),
  format: z.looseObject({ format_name: z.string().optional(), duration: z.string().optional() }).optional(),
});
export type FfprobeOutput = z.infer<typeof FfprobeOutputSchema>;

const IMAGE_CODECS = new Set(["mjpeg", "png", "webp", "bmp", "tiff"]);

function seconds(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function frameRate(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const [num, den] = value.split("/").map(Number);
  if (num === undefined || !Number.isFinite(num) || num <= 0) return undefined;
  const rate = den === undefined ? num : den > 0 ? num / den : undefined;
  return rate === undefined ? undefined : Math.round(rate * 1000) / 1000;
}

/** Phone videos store portrait as landscape pixels plus a rotation flag (old `rotate` tag or display matrix). */
function rotationDegrees(stream: Stream): number {
  const tag = stream.tags?.rotate;
  const fromTag = tag === undefined ? undefined : Number.parseFloat(tag);
  const fromSideData = stream.side_data_list?.find((data) => data.rotation !== undefined)?.rotation;
  const raw = fromSideData ?? (fromTag !== undefined && Number.isFinite(fromTag) ? fromTag : 0);
  return ((Math.round(raw) % 360) + 360) % 360;
}

function isImage(stream: Stream, output: FfprobeOutput): boolean {
  if (!IMAGE_CODECS.has(stream.codec_name ?? "")) return false;
  const formatName = output.format?.format_name ?? "";
  const duration = seconds(output.format?.duration) ?? seconds(stream.duration) ?? 0;
  return formatName === "image2" || formatName.endsWith("_pipe") || duration < 0.05;
}

export function interpretProbe(output: FfprobeOutput): ProbeResult {
  // Cover art in MP3/M4A shows up as a video stream marked attached_pic; it is not a video.
  const visual = output.streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const audio = output.streams.find((s) => s.codec_type === "audio");
  const durationSeconds =
    seconds(output.format?.duration) ?? seconds(visual?.duration) ?? seconds(audio?.duration);
  const durationMs = durationSeconds === undefined ? undefined : Math.round(durationSeconds * 1000);

  if (visual) {
    // The audio/container can outlast the picture. Seeking frames must use the video stream's length.
    const visualSeconds = seconds(visual.duration);
    const videoSeconds = visualSeconds !== undefined && visualSeconds > 0 ? visualSeconds : durationSeconds;
    const rotated = rotationDegrees(visual) % 180 === 90;
    const width = rotated ? visual.height : visual.width;
    const height = rotated ? visual.width : visual.height;
    const size = { ...(width !== undefined && { width }), ...(height !== undefined && { height }) };
    const codec = visual.codec_name === undefined ? {} : { codec: visual.codec_name };

    if (isImage(visual, output)) return { kind: "image", hasAudio: false, ...size, ...codec };

    const fps = frameRate(visual.avg_frame_rate) ?? frameRate(visual.r_frame_rate);
    return {
      kind: "video",
      hasAudio: audio !== undefined,
      ...size,
      ...codec,
      ...(videoSeconds !== undefined && { durationMs: Math.round(videoSeconds * 1000) }),
      ...(fps !== undefined && { fps }),
    };
  }

  if (audio) {
    return {
      kind: "audio",
      hasAudio: true,
      ...(durationMs !== undefined && { durationMs }),
      ...(audio.codec_name !== undefined && { codec: audio.codec_name }),
    };
  }
  throw new DomainError("INVALID_MEDIA", "The file has no video, image or audio stream");
}
