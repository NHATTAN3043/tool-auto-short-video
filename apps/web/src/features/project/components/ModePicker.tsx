"use client";

import { AutomationModeSchema, type AutomationMode } from "@studio/domain";
import { CircleCheckIcon, KeyRoundIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";

import { MODE_LABELS, MODE_REQUIREMENTS } from "../labels";

export function ModePicker({
  value,
  onChange,
  layout = "row",
  showRequirements = false,
}: {
  value: AutomationMode;
  onChange: (mode: AutomationMode) => void;
  /** "row": three cards side by side from `sm`; "stack": one card per line. */
  layout?: "row" | "stack";
  /** Adds a line under each card saying whether the mode needs an API key. */
  showRequirements?: boolean;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        onChange(AutomationModeSchema.parse(next));
      }}
      className={cn("grid gap-3", layout === "row" && "sm:grid-cols-3")}
    >
      {AutomationModeSchema.options.map((mode) => (
        <Label
          key={mode}
          htmlFor={`mode-${mode}`}
          className={cn(
            "flex cursor-pointer flex-col items-start gap-2 rounded-lg border p-4 font-normal transition-colors hover:bg-accent",
            value === mode && "border-primary ring-1 ring-primary",
          )}
        >
          <span className="flex items-center gap-2 font-medium">
            <RadioGroupItem id={`mode-${mode}`} value={mode} />
            {MODE_LABELS[mode].title}
          </span>
          <span className="text-sm text-muted-foreground">{MODE_LABELS[mode].description}</span>
          {showRequirements ? (
            <span className="mt-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              {mode === "manual" ? (
                <CircleCheckIcon className="size-3.5" />
              ) : (
                <KeyRoundIcon className="size-3.5" />
              )}
              {MODE_REQUIREMENTS[mode]}
            </span>
          ) : null}
        </Label>
      ))}
    </RadioGroup>
  );
}
