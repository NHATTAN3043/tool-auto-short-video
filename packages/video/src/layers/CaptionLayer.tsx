import type { CaptionStyle, RenderPlanCaption } from "@studio/domain";
import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { CAPTION_FONT_FAMILY, outlineShadow } from "../style";

function CaptionText({ text, style }: { text: string; style: CaptionStyle }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, from: 0.86, to: 1, config: { damping: 14, mass: 0.5 } });
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${String(style.positionY * 100)}%`,
          transform: `translateY(-50%) scale(${String(pop)})`,
          padding: "0 80px",
          textAlign: "center",
          fontFamily: `"${CAPTION_FONT_FAMILY}", sans-serif`,
          fontWeight: 800,
          fontSize: style.fontSize,
          lineHeight: 1.25,
          color: style.color,
          textShadow: outlineShadow(Math.max(3, Math.round(style.fontSize / 14))),
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
}

/** Top layer, independent of scenes, so captions never fade with scene transitions. */
export function CaptionLayer({ captions, style }: { captions: RenderPlanCaption[]; style: CaptionStyle }) {
  return (
    <>
      {captions.map((caption, i) => (
        <Sequence
          key={`caption-${String(i)}`}
          from={caption.from}
          durationInFrames={caption.durationInFrames}
          name="Caption"
        >
          <CaptionText text={caption.text} style={style} />
        </Sequence>
      ))}
    </>
  );
}
