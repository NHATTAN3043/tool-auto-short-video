import type { RenderPlanMedia, RenderPlanScene } from "@studio/domain";
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, Loop, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";

import { fadeInOpacity, focusPosition, kenBurnsScale, placeholderGradient } from "../style";

const fill: CSSProperties = { width: "100%", height: "100%" };

function MediaElement({
  media,
  fit,
  muted,
}: {
  media: RenderPlanMedia;
  fit: "cover" | "contain";
  muted: boolean;
}) {
  const style: CSSProperties = { ...fill, objectFit: fit, objectPosition: focusPosition(media.focusX) };
  if (media.kind === "image") return <Img src={media.src} style={style} />;

  const volume = muted ? 0 : media.volume;
  const video = (
    <OffthreadVideo
      src={media.src}
      style={style}
      trimBefore={media.startFrom}
      durationInFrames={media.segmentFrames}
      volume={volume}
      muted={volume === 0}
    />
  );
  // A source segment shorter than the scene would otherwise freeze/black out at its end.
  return media.loop ? <Loop durationInFrames={media.segmentFrames}>{video}</Loop> : video;
}

function Visual({ media, durationInFrames }: { media: RenderPlanMedia; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const scale = media.kind === "image" && media.kenBurns ? kenBurnsScale(frame, durationInFrames) : 1;
  const zoom = (children: ReactNode, extra = "") => (
    <AbsoluteFill style={{ transform: `${extra} scale(${String(scale)})`.trim() }}>{children}</AbsoluteFill>
  );

  if (media.fit === "cover") return zoom(<MediaElement media={media} fit="cover" muted={false} />);
  // Contain: the same media blurred as a backdrop, the classic Shorts look for landscape sources.
  return (
    <>
      <AbsoluteFill style={{ filter: "blur(40px) brightness(0.6)", transform: "scale(1.15)" }}>
        <MediaElement media={media} fit="cover" muted />
      </AbsoluteFill>
      {zoom(<MediaElement media={media} fit="contain" muted={false} />)}
    </>
  );
}

function SceneContent({
  scene,
  transitionFrames,
  background,
}: {
  scene: RenderPlanScene;
  transitionFrames: number;
  background: string;
}) {
  const frame = useCurrentFrame();
  const opacity = fadeInOpacity(frame, transitionFrames, scene.index === 0);
  return (
    <AbsoluteFill style={{ opacity, backgroundColor: background }}>
      {scene.media ? (
        <Visual media={scene.media} durationInFrames={scene.sequenceDurationInFrames} />
      ) : (
        <AbsoluteFill style={{ background: placeholderGradient(scene.index) }} />
      )}
    </AbsoluteFill>
  );
}

/** One scene, mounted for its slot plus the overlap the next scene fades in over. */
export function SceneLayer(props: { scene: RenderPlanScene; transitionFrames: number; background: string }) {
  return (
    <Sequence
      from={props.scene.from}
      durationInFrames={props.scene.sequenceDurationInFrames}
      name={`Scene ${String(props.scene.index + 1)}`}
    >
      <SceneContent {...props} />
    </Sequence>
  );
}
