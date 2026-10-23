export interface DetectCutsOptions {
  /** ffmpeg `scdet` threshold, 0–100: lower finds more cuts. */
  threshold?: number;
}

export interface GrabFramesOptions {
  /** Longest side of each frame in pixels; small frames keep the AI call cheap. */
  maxSide: number;
}

/** Reads a video's shots (ADR 0019): where the picture changes, and one still per shot. */
export interface ClipFramesPort {
  /** Times in ms where the picture changes, in order; empty for a single continuous shot. */
  detectCuts(absoluteInput: string, options?: DetectCutsOptions): Promise<number[]>;
  /**
   * One upright JPEG per time, written into `absoluteOutDir` as `frame-000.jpg`, `frame-001.jpg`…; resolves
   * with their absolute paths in the same order.
   */
  grabFrames(
    absoluteInput: string,
    atMs: readonly number[],
    absoluteOutDir: string,
    options: GrabFramesOptions,
  ): Promise<string[]>;
}
