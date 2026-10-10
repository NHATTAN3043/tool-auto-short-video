"use client";

import { TransitionSchema, type ProjectStyle, type StylePatch } from "@studio/domain";
import { useId, type ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { Slider } from "@/shared/ui/slider";
import { Switch } from "@/shared/ui/switch";

import { STYLE_LIMITS, TRANSITION_LABELS } from "../labels";

function SliderRow({
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

/** Caption look and scene transition. Every change shows in the preview right away. */
export function StyleSettings({
  style,
  onChange,
  onCommit,
}: {
  style: ProjectStyle;
  onChange: (patch: StylePatch) => void;
  /** Ends a slider drag, so the drag is one undo step. */
  onCommit: () => void;
}) {
  const enabledId = useId();
  const uppercaseId = useId();
  const transitionName = useId();
  const { captions } = style;
  const off = !captions.enabled;
  const apply = (patch: StylePatch) => {
    onChange(patch);
    onCommit();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phụ đề và chuyển cảnh</CardTitle>
        <CardDescription>Phụ đề tạo từ lời đọc của từng cảnh, khớp theo thời lượng cảnh.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id={enabledId}
                checked={captions.enabled}
                onCheckedChange={(enabled) => {
                  apply({ captions: { enabled } });
                }}
              />
              <Label htmlFor={enabledId}>Hiện phụ đề</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={uppercaseId}
                checked={captions.uppercase}
                disabled={off}
                onCheckedChange={(uppercase) => {
                  apply({ captions: { uppercase } });
                }}
              />
              <Label htmlFor={uppercaseId}>Viết hoa</Label>
            </div>
          </div>
          <SliderRow
            label="Cỡ chữ"
            value={captions.fontSize}
            display={captions.fontSize}
            {...STYLE_LIMITS.fontSize}
            disabled={off}
            onChange={(fontSize) => {
              onChange({ captions: { fontSize } });
            }}
            onCommit={onCommit}
          />
          <SliderRow
            label="Vị trí (từ trên xuống)"
            value={Math.round(captions.positionY * 100)}
            display={`${String(Math.round(captions.positionY * 100))}%`}
            {...STYLE_LIMITS.positionPercent}
            disabled={off}
            onChange={(percent) => {
              onChange({ captions: { positionY: percent / 100 } });
            }}
            onCommit={onCommit}
          />
          <SliderRow
            label="Số từ mỗi dòng"
            value={captions.maxWordsPerCaption}
            display={captions.maxWordsPerCaption}
            {...STYLE_LIMITS.wordsPerCaption}
            disabled={off}
            onChange={(maxWordsPerCaption) => {
              onChange({ captions: { maxWordsPerCaption } });
            }}
            onCommit={onCommit}
          />
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium">Chuyển cảnh</span>
          <RadioGroup
            value={style.transition}
            onValueChange={(next) => {
              apply({ transition: TransitionSchema.parse(next) });
            }}
            className="flex gap-4"
          >
            {TransitionSchema.options.map((transition) => (
              <Label key={transition} htmlFor={`${transitionName}-${transition}`} className="font-normal">
                <RadioGroupItem id={`${transitionName}-${transition}`} value={transition} />
                {TRANSITION_LABELS[transition]}
              </Label>
            ))}
          </RadioGroup>
          {style.transition === "fade" ? (
            <SliderRow
              label="Thời lượng"
              value={style.transitionMs}
              display={`${(style.transitionMs / 1000).toFixed(2).replace(".", ",")}s`}
              {...STYLE_LIMITS.transitionMs}
              onChange={(transitionMs) => {
                onChange({ transitionMs });
              }}
              onCommit={onCommit}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
