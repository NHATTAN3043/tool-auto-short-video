// Pure rules for the video segment picker. Domain milliseconds in, domain milliseconds out.

/** Shortest segment the picker allows, so start and end never collapse onto each other. */
export const MIN_SEGMENT_MS = 100;

export interface Segment {
  sourceStartMs: number;
  /** null = play until the scene ends (looping when the source is shorter). */
  sourceEndMs: number | null;
}

/** Keeps a segment inside the video and at least MIN_SEGMENT_MS long; the start wins over the end. */
export function clampSegment(segment: Segment, durationMs: number): Segment {
  const duration = Math.max(MIN_SEGMENT_MS, Math.round(durationMs));
  let start = Math.min(Math.max(0, Math.round(segment.sourceStartMs)), duration - MIN_SEGMENT_MS);
  if (segment.sourceEndMs === null) return { sourceStartMs: start, sourceEndMs: null };
  const end = Math.min(Math.max(Math.round(segment.sourceEndMs), start + MIN_SEGMENT_MS), duration);
  start = Math.min(start, end - MIN_SEGMENT_MS);
  return { sourceStartMs: start, sourceEndMs: end };
}

/** Values for the two-thumb slider; an open end shows at the end of the video. */
export function sliderValues(segment: Segment, durationMs: number): [number, number] {
  return [segment.sourceStartMs, segment.sourceEndMs ?? durationMs];
}

/** Turns a slider change back into a segment; an open end stays open while only the start moves. */
export function segmentFromSlider(
  [start = 0, end = 0]: readonly number[],
  previous: Segment,
  durationMs: number,
): Segment {
  const endMoved = previous.sourceEndMs === null ? end !== durationMs : end !== previous.sourceEndMs;
  return clampSegment(
    { sourceStartMs: start, sourceEndMs: previous.sourceEndMs === null && !endMoved ? null : end },
    durationMs,
  );
}

/** Sets one edge to the playhead, e.g. "start here" while previewing. */
export function setEdgeAt(
  segment: Segment,
  edge: "start" | "end",
  atMs: number,
  durationMs: number,
): Segment {
  if (edge === "start") {
    const end = segment.sourceEndMs;
    // Moving the start past a fixed end drops the end rather than producing an empty segment.
    const keepEnd = end !== null && atMs + MIN_SEGMENT_MS <= end;
    return clampSegment({ sourceStartMs: atMs, sourceEndMs: keepEnd ? end : null }, durationMs);
  }
  return clampSegment({ ...segment, sourceEndMs: atMs }, durationMs);
}

/** Where a playing preview jumps back to once it passes the end of the segment, or null to keep going. */
export function loopPosition(currentMs: number, segment: Segment): number | null {
  return segment.sourceEndMs !== null && currentMs >= segment.sourceEndMs ? segment.sourceStartMs : null;
}
