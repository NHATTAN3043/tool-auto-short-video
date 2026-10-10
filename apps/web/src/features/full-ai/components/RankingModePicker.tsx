"use client";

import { MediaRankingModeSchema, type MediaRankingMode } from "@studio/domain";
import { useId } from "react";

import { cn } from "@/shared/lib/utils";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";

import { RANKING_MODE_LABELS } from "../model";

/** How AI ranks media: by description (cheap) or by looking at thumbnails (more accurate, costlier). */
export function RankingModePicker({
  value,
  onChange,
  compact = false,
}: {
  value: MediaRankingMode;
  onChange: (mode: MediaRankingMode) => void;
  /** One line per option, for narrow panels. */
  compact?: boolean;
}) {
  const id = useId();
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        onChange(MediaRankingModeSchema.parse(next));
      }}
      className={cn("grid gap-2", !compact && "sm:grid-cols-2")}
    >
      {MediaRankingModeSchema.options.map((mode) => (
        <Label
          key={mode}
          htmlFor={`${id}-${mode}`}
          className={cn(
            "flex cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 font-normal transition-colors hover:bg-accent",
            value === mode && "border-primary ring-1 ring-primary",
          )}
        >
          <span className="flex items-center gap-2 font-medium">
            <RadioGroupItem id={`${id}-${mode}`} value={mode} />
            {RANKING_MODE_LABELS[mode].title}
          </span>
          {compact ? null : (
            <span className="text-xs text-muted-foreground">{RANKING_MODE_LABELS[mode].description}</span>
          )}
        </Label>
      ))}
    </RadioGroup>
  );
}
