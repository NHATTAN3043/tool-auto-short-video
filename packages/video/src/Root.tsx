import { DEFAULT_CAPTION_STYLE, type RenderPlan } from "@studio/domain";
import { Composition } from "remotion";

import { COMPOSITION_ID } from "./meta";
import { ProjectVideo } from "./ProjectVideo";

const EMPTY_PLAN: RenderPlan = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 0,
  transitionFrames: 0,
  background: "#000000",
  scenes: [],
  voices: [],
  sfx: [],
  captions: [],
  captionStyle: { ...DEFAULT_CAPTION_STYLE },
};

export function RemotionRoot() {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={ProjectVideo}
      width={EMPTY_PLAN.width}
      height={EMPTY_PLAN.height}
      fps={EMPTY_PLAN.fps}
      durationInFrames={1}
      defaultProps={{ plan: EMPTY_PLAN }}
      // Size, fps and length all come from the plan, so the composition itself never decides timing.
      calculateMetadata={({ props }) => ({
        width: props.plan.width,
        height: props.plan.height,
        fps: props.plan.fps,
        durationInFrames: Math.max(1, props.plan.durationInFrames),
      })}
    />
  );
}
