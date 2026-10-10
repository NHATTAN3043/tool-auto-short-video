"use client";

import type { PlayerRef } from "@remotion/player";
import type { Project } from "@studio/domain";
import { useCallback, useMemo, useRef } from "react";

import { previewPlan, sceneStartFrame } from "../plan";

/** Plan for the player, rebuilt whenever the project changes, and a way to jump to a scene. */
export function usePreview(project: Project) {
  const playerRef = useRef<PlayerRef | null>(null);
  const preview = useMemo(() => previewPlan(project), [project]);

  const seekToScene = useCallback(
    (sceneId: string) => {
      if (!preview.ok) return;
      const frame = sceneStartFrame(preview.plan, sceneId);
      if (frame === null || !playerRef.current) return;
      playerRef.current.pause();
      playerRef.current.seekTo(frame);
    },
    [preview],
  );

  return { preview, playerRef, seekToScene };
}
