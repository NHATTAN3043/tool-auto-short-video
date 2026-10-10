import { MAX_SFX_OFFSET_MS } from "@studio/domain";

// Sound effect offsets are typed in seconds with a Vietnamese decimal comma, like scene durations.

/** `1500` → `1,5`. */
export function formatOffsetInput(ms: number): string {
  return String(Math.round(ms / 100) / 10).replace(".", ",");
}

export type ParsedOffset = { ok: true; offsetMs: number } | { ok: false; error: string };

/** Empty = 0 (scene start). Accepts `2`, `1.5` or `1,5` seconds. */
export function parseOffsetInput(text: string): ParsedOffset {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, offsetMs: 0 };
  if (!/^\d+(?:[.,]\d+)?$/u.test(trimmed)) return { ok: false, error: "Nhập số giây, ví dụ 1,5." };
  const offsetMs = Math.round(Number(trimmed.replace(",", ".")) * 1000);
  if (offsetMs > MAX_SFX_OFFSET_MS) {
    return { ok: false, error: `Tối đa ${String(MAX_SFX_OFFSET_MS / 1000)} giây.` };
  }
  return { ok: true, offsetMs };
}

/** `800` → `0,8 giây`; unknown length shows nothing. */
export function formatSfxLength(durationMs: number | undefined): string {
  return durationMs === undefined ? "" : `${formatOffsetInput(durationMs)} giây`;
}
