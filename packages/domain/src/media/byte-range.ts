export type ByteRange = { start: number; end: number } | "invalid" | null;

/**
 * Parses an HTTP `Range: bytes=…` header against a file of `size` bytes. Returns null when there is no
 * header and "invalid" when it cannot be satisfied (HTTP 416). Only a single range is supported:
 * browsers never ask for several when seeking in media.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange {
  if (header === undefined || header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return "invalid";
  const [, startText = "", endText = ""] = match;
  if (startText === "") {
    const suffix = Number(endText);
    if (suffix === 0 || size === 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  return start >= size || end < start ? "invalid" : { start, end };
}
