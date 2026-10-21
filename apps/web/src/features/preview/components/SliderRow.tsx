"use client";

import type { ReactNode } from "react";

import { Slider } from "@/shared/ui/slider";

/** A labelled slider with its value; `onCommit` ends a drag, so the drag is one undo step. */
export function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  disabled = false,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  display: ReactNode;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 text-sm text-muted-foreground">{label}</span>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        thumbLabels={[label]}
        onValueChange={([next = value]) => {
          onChange(next);
        }}
        onValueCommit={onCommit}
      />
      <span className="w-14 text-right font-mono text-sm">{display}</span>
    </div>
  );
}
