"use client";

import { activeVoiceTrack, VoiceTrackSchema, type Project, type VoiceTrack } from "@studio/domain";
import { useId } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";

const TRACK_LABELS: Record<VoiceTrack, { title: string; description: string }> = {
  project: {
    title: "Voice chung của dự án",
    description: "Một file đọc cả video; giọng từng cảnh tạm tắt.",
  },
  scenes: {
    title: "Voice từng cảnh",
    description: "Mỗi cảnh phát giọng riêng; voice chung tạm tắt. Cảnh chưa có giọng sẽ im lặng.",
  },
};

/**
 * Shown when the project has both a whole-video voice and scene voices: only one track plays so they
 * never overlap. Both stay stored, so switching back is instant.
 */
export function VoiceTrackChooser({
  project,
  onChange,
}: {
  project: Project;
  onChange: (track: VoiceTrack) => void;
}) {
  const name = useId();
  const active = activeVoiceTrack(project) ?? "project";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice được phát</CardTitle>
        <CardDescription>
          Dự án có cả voice chung và giọng từng cảnh. Chọn giữ loại nào; loại còn lại không bị xoá.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={active}
          onValueChange={(next) => {
            onChange(VoiceTrackSchema.parse(next));
          }}
          className="flex flex-col gap-3"
        >
          {VoiceTrackSchema.options.map((track) => (
            <Label key={track} htmlFor={`${name}-${track}`} className="items-start font-normal">
              <RadioGroupItem id={`${name}-${track}`} value={track} />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{TRACK_LABELS[track].title}</span>
                <span className="text-xs text-muted-foreground">{TRACK_LABELS[track].description}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
