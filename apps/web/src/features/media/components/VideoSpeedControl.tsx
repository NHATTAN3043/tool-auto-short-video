"use client";

import { SCENE_PLAYBACK_RATE_MAX, SCENE_PLAYBACK_RATE_MIN } from "@studio/domain";
import { useId, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Slider } from "@/shared/ui/slider";

import { formatPlaybackRate, parsePlaybackRate, PLAYBACK_RATE_STEP } from "../playback-rate";

export function VideoSpeedControl({
  value,
  canFitToVoice,
  onChange,
  onCommit,
  onFitSpeed,
}: {
  value: number;
  canFitToVoice: boolean;
  onChange: (value: number) => void;
  onCommit: () => void;
  onFitSpeed: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(() => formatPlaybackRate(value));
  const [seen, setSeen] = useState(value);
  const [error, setError] = useState<string | null>(null);
  // External changes (slider, automatic fit, undo) replace the draft before the next paint.
  if (seen !== value) {
    setSeen(value);
    setText(formatPlaybackRate(value));
    setError(null);
  }
  const commit = () => {
    // An untouched automatically fitted value may have more precision than the manual step.
    if (text === formatPlaybackRate(value)) return;
    const next = parsePlaybackRate(text);
    if (next === null) {
      setError("Nhập tốc độ từ 0,5 đến 2.");
      return;
    }
    setError(null);
    setText(formatPlaybackRate(next));
    if (next !== value) {
      onChange(next);
      onCommit();
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor={id} className="w-28 shrink-0 font-normal text-muted-foreground">
          Tốc độ media trong cảnh
        </Label>
        <Slider
          min={SCENE_PLAYBACK_RATE_MIN}
          max={SCENE_PLAYBACK_RATE_MAX}
          step={PLAYBACK_RATE_STEP}
          value={[value]}
          className="min-w-32 flex-1"
          thumbLabels={["Tốc độ media trong cảnh"]}
          onValueChange={([next]) => {
            if (next !== undefined) onChange(next);
          }}
          onValueCommit={onCommit}
        />
        <div className="flex items-center gap-1">
          <Input
            id={id}
            inputMode="decimal"
            className="h-8 w-20 font-mono text-sm"
            value={text}
            aria-invalid={error !== null}
            aria-describedby={error ? `${id}-error` : `${id}-hint`}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                setText(formatPlaybackRate(value));
                setError(null);
              }
            }}
          />
          <span aria-hidden="true">×</span>
        </div>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        Chỉ đổi tốc độ media; thời lượng cảnh và giọng đọc giữ nguyên.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          disabled={!canFitToVoice}
          title={canFitToVoice ? undefined : "Cần đoạn video và giọng đọc có thời lượng xác định"}
          onClick={onFitSpeed}
        >
          Khớp tốc độ với giọng
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setText("1");
            setError(null);
            onChange(1);
            onCommit();
          }}
        >
          Về 1×
        </Button>
      </div>
    </div>
  );
}
