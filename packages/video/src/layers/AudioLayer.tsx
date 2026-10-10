import type { RenderPlan } from "@studio/domain";
import { Html5Audio, Sequence } from "remotion";

export function AudioLayer({ plan }: { plan: RenderPlan }) {
  return (
    <>
      {plan.voices.map((voice, i) => (
        <Sequence
          key={`voice-${String(i)}`}
          from={voice.from}
          durationInFrames={voice.durationInFrames}
          name="Voice"
        >
          <Html5Audio src={voice.src} />
        </Sequence>
      ))}
      {plan.sfx.map((effect, i) => (
        <Sequence
          key={`sfx-${String(i)}`}
          from={effect.from}
          durationInFrames={effect.durationInFrames}
          name="Sound effect"
        >
          <Html5Audio src={effect.src} volume={effect.volume} />
        </Sequence>
      ))}
      {plan.music ? <Html5Audio src={plan.music.src} volume={plan.music.volume} loop /> : null}
    </>
  );
}
