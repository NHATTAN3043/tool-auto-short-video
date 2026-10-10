import type { MediaAsset } from "@studio/domain";

// Display helpers for the media library (Vietnamese decimal comma).

/** `83400` → `1:23`. Whole seconds are enough on a thumbnail. */
export function formatClock(ms: number): string {
  const total = Math.round(Math.max(0, ms) / 1000);
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;
}

/** `15300` → `0:15,3`. Tenths, for picking a segment precisely. */
export function formatClockTenths(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${String(minutes)}:${String(seconds).padStart(2, "0")},${String(tenths % 10)}`;
}

/** `1920×1080`, or null when the size is unknown (audio). */
export function formatResolution(asset: Pick<MediaAsset, "width" | "height">): string | null {
  return asset.width !== undefined && asset.height !== undefined
    ? `${String(asset.width)}×${String(asset.height)}`
    : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${(Math.round(value * 10) / 10).toString().replace(".", ",")} ${units[unit] ?? "GB"}`;
}

/** Whole percent, e.g. `0.5` → `50%`. */
export function formatPercent(fraction: number): string {
  return `${String(Math.round(Math.min(1, Math.max(0, fraction)) * 100))}%`;
}
