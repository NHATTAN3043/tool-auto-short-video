import type { RenderPlanWatermark } from "@studio/domain";
import { AbsoluteFill, Img } from "remotion";

/**
 * The channel logo, cut to a circle on screen only (the uploaded file stays as it is). Top layer for the
 * whole video, so it never fades with scene transitions or hides under a caption.
 */
export function WatermarkLayer({ watermark }: { watermark: RenderPlanWatermark | undefined }) {
  if (!watermark) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Img
        src={watermark.src}
        style={{
          position: "absolute",
          left: watermark.left,
          top: watermark.top,
          width: watermark.diameter,
          height: watermark.diameter,
          boxSizing: "border-box",
          borderRadius: "50%",
          objectFit: "cover",
          border:
            watermark.borderWidth > 0
              ? `${String(watermark.borderWidth)}px solid ${watermark.borderColor}`
              : undefined,
          opacity: watermark.opacity,
          boxShadow: "0 2px 10px rgba(0, 0, 0, 0.35)",
        }}
      />
    </AbsoluteFill>
  );
}
