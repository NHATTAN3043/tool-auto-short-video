import type { MediaFit, MediaKind } from "@studio/domain";

export const KIND_LABELS: Record<MediaKind, string> = {
  video: "Video",
  image: "Ảnh",
  audio: "Âm thanh",
};

export const FIT_LABELS: Record<MediaFit, { title: string; description: string }> = {
  cover: { title: "Lấp đầy khung", description: "Cắt bớt hai bên cho vừa khung dọc" },
  contain: { title: "Vừa khung", description: "Giữ nguyên hình, nền mờ phía sau" },
};

/** Music starts quiet so it never drowns the voice. */
export const DEFAULT_MUSIC_VOLUME = 0.15;

/** Length given to a segment when its open end is closed: a few seconds is a sensible first guess. */
export const DEFAULT_SEGMENT_MS = 5000;
