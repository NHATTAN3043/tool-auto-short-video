import type { MediaKind } from "@studio/domain";

export interface ProbeResult {
  kind: MediaKind;
  /** Missing for images. */
  durationMs?: number;
  /** Display size: already swapped for phone videos recorded with a 90/270° rotation flag. */
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  /** Main stream codec, e.g. "h264", "hevc", "png", "mp3". */
  codec?: string;
}

export interface ThumbnailOptions {
  atMs: number;
  width: number;
}

export interface MediaProbePort {
  /** Throws when the file is not readable media. */
  probe(absolutePath: string): Promise<ProbeResult>;
  createThumbnail(absoluteInput: string, absoluteOutput: string, options: ThumbnailOptions): Promise<void>;
}
