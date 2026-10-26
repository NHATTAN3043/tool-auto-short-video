import { SCENE_PLAYBACK_RATE_MAX, SCENE_PLAYBACK_RATE_MIN } from "@studio/domain";

export const PLAYBACK_RATE_STEP = 0.01;

/** Keep the three decimals of automatic fitting until the user changes the value. */
export const formatPlaybackRate = (value: number) => String(value).replace(".", ",");

export function parsePlaybackRate(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < SCENE_PLAYBACK_RATE_MIN || value > SCENE_PLAYBACK_RATE_MAX) {
    return null;
  }
  return Math.round(value * 100) / 100;
}
