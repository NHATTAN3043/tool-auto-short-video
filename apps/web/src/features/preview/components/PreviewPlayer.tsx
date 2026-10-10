"use client";

import { Player, type ErrorFallback, type PlayerRef } from "@remotion/player";
import type { RenderPlan } from "@studio/domain";
import { ProjectVideo } from "@studio/video";
import type { RefObject } from "react";

// A media file the browser cannot play (HEVC, a file that failed to load) shows this instead of a
// broken player. The worker render does not depend on browser codecs, so rendering may still work.
const errorFallback: ErrorFallback = () => (
  <div className="flex size-full flex-col items-center justify-center gap-2 bg-black p-6 text-center text-sm text-white">
    <p>Trình duyệt không phát được một file media trong dự án.</p>
    <p className="text-white/70">
      Video quay bằng iPhone (HEVC) thường gặp lỗi này. Thử đổi media của cảnh, hoặc tải lại trang.
    </p>
  </div>
);

/**
 * Remotion Player around the very composition the worker renders. Loaded only in the browser: the
 * composition loads its font through `document`, which does not exist during server rendering.
 */
export function PreviewPlayer({
  plan,
  playerRef,
}: {
  plan: RenderPlan;
  playerRef: RefObject<PlayerRef | null>;
}) {
  return (
    <Player
      ref={playerRef}
      component={ProjectVideo}
      inputProps={{ plan }}
      durationInFrames={Math.max(1, plan.durationInFrames)}
      compositionWidth={plan.width}
      compositionHeight={plan.height}
      fps={plan.fps}
      controls
      clickToPlay
      errorFallback={errorFallback}
      style={{ width: "100%", aspectRatio: `${String(plan.width)} / ${String(plan.height)}` }}
      className="overflow-hidden rounded-md bg-black"
    />
  );
}
