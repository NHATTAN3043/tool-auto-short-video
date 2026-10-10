export interface ClipRange {
  startMs: number;
  endMs: number;
}

/** Cuts a frame-accurate piece out of a rendered video (re-encoded, so cuts need no keyframe). */
export interface ClipCutterPort {
  cut(absoluteInput: string, absoluteOutput: string, range: ClipRange): Promise<void>;
}
