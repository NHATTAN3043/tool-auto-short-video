"use client";

import { AutomationModeSchema, type AutomationMode } from "@studio/domain";

import { cn } from "@/shared/lib/utils";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";

import { MODE_LABELS } from "../labels";

export function ModePicker({
  value,
  onChange,
}: {
  value: AutomationMode;
  onChange: (mode: AutomationMode) => void;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        onChange(AutomationModeSchema.parse(next));
      }}
      className="grid gap-3 sm:grid-cols-3"
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
        </Label>
      ))}
    </RadioGroup>
  );
}
