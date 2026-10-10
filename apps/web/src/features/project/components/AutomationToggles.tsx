"use client";

import type { AutomationSettings } from "@studio/domain";

import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";

import { SETTING_LABELS } from "../labels";
import { SETTING_KEYS } from "../model";

export function AutomationToggles({
  settings,
  onToggle,
}: {
  settings: AutomationSettings;
  onToggle: (key: keyof AutomationSettings, value: boolean) => void;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {SETTING_KEYS.map((key) => (
        <li key={key} className="flex items-center justify-between gap-4 p-3">
          <Label
            htmlFor={`setting-${key}`}
            className="flex cursor-pointer flex-col items-start gap-1 font-normal"
          >
            <span className="font-medium">{SETTING_LABELS[key].title}</span>
            <span className="text-sm text-muted-foreground">{SETTING_LABELS[key].description}</span>
          </Label>
          <Switch
            id={`setting-${key}`}
            checked={settings[key]}
            onCheckedChange={(checked) => {
              onToggle(key, checked);
            }}
          />
        </li>
      ))}
    </ul>
  );
}
