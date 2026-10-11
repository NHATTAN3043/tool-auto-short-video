"use client";

import type { AutomationSettings } from "@studio/domain";

import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";

import { SETTING_LABELS } from "../labels";
import { SETTING_GROUPS } from "../model";

export function AutomationToggles({
  settings,
  onToggle,
}: {
  settings: AutomationSettings;
  onToggle: (key: keyof AutomationSettings, value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {SETTING_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1.5">
          <span className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {group.title}
          </span>
          <ul className="divide-y rounded-lg border">
            {group.keys.map((key) => (
              <li key={key} className="flex items-center justify-between gap-4 px-3 py-2.5">
                <Label
                  htmlFor={`setting-${key}`}
                  className="flex cursor-pointer flex-col items-start gap-0.5 font-normal"
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
        </div>
      ))}
    </div>
  );
}
