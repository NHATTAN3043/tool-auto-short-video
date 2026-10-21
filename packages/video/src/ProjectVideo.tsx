import type { RenderPlan } from "@studio/domain";
import { AbsoluteFill } from "remotion";

import "./fonts";
import { AudioLayer } from "./layers/AudioLayer";
import { CaptionLayer } from "./layers/CaptionLayer";
import { SceneLayer } from "./layers/SceneLayer";
import { WatermarkLayer } from "./layers/WatermarkLayer";

export interface ProjectVideoProps extends Record<string, unknown> {
  plan: RenderPlan;
}

/**
 * The only composition: used by the browser preview and the worker render alike. It lays out a
 * RenderPlan and computes no timing of its own.
 */
export function ProjectVideo({ plan }: ProjectVideoProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: plan.background }}>
      {/* Later scenes render on top, so each one fades in over the one before. */}
      {plan.scenes.map((scene) => (
        <SceneLayer
          key={scene.sceneId}
          scene={scene}
          transitionFrames={plan.transitionFrames}
          background={plan.background}
        />
      ))}
      <AudioLayer plan={plan} />
      <CaptionLayer captions={plan.captions} style={plan.captionStyle} />
      <WatermarkLayer watermark={plan.watermark} />
    </AbsoluteFill>
  );
}
