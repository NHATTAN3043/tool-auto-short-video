"use client";

import { projectLanguage, type Project, type VoiceSettings } from "@studio/domain";
import { Loader2Icon, PlayIcon, SquareIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";

import type { VoiceCatalog } from "../api";
import { useVoicePreview, type VoicePreviewKind } from "../hooks/use-voice-preview";
import {
  defaultPreviewText,
  isPreviewTextValid,
  previewCredits,
  previewLength,
  VOICE_PREVIEW_MAX_CHARACTERS,
} from "../model";

const numbers = new Intl.NumberFormat("vi-VN");

/**
 * Hear a voice before voicing every scene: the provider's free sample, or a sentence spoken with the
 * settings shown above (paid once per text and settings). Never changes the project.
 */
export function VoicePreview({
  project,
  settings,
  catalog,
}: {
  project: Project;
  settings: VoiceSettings;
  catalog: VoiceCatalog;
}) {
  const textId = useId();
  const [text, setText] = useState(() => defaultPreviewText(project));
  const preview = useVoicePreview(project.id);
  const input = { text, voice: settings, language: projectLanguage(project) };
  const valid = isPreviewTextValid(text);
  const heard = valid && preview.isHeard(input);

  function icon(kind: VoicePreviewKind) {
    if (preview.loading === kind) return <Loader2Icon className="animate-spin" />;
    return preview.playing === kind ? <SquareIcon /> : <PlayIcon />;
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={textId}>Nghe thử giọng</Label>
        <Button
          variant="outline"
          size="sm"
          disabled={preview.loading !== null}
          onClick={() => {
            if (preview.playing === "sample") preview.stop();
            else void preview.playSample(settings.voiceId);
          }}
        >
          {icon("sample")}
          Nghe mẫu gốc
        </Button>
      </div>
      <Textarea
        id={textId}
        rows={2}
        maxLength={VOICE_PREVIEW_MAX_CHARACTERS * 2}
        value={text}
        aria-invalid={!valid}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={!valid || preview.loading !== null}
          onClick={() => {
            if (preview.playing === "preview") preview.stop();
            else void preview.playPreview(input);
          }}
        >
          {icon("preview")}
          Nghe thử với thiết lập này
        </Button>
        <span className="text-xs text-muted-foreground">
          {heard
            ? "Đã tạo trước đó, nghe lại không tốn thêm."
            : `≈ ${numbers.format(previewCredits(text, settings.modelId, catalog))} credit`}
          {" · "}
          <span className={valid ? undefined : "text-destructive"}>
            {numbers.format(previewLength(text))}/{numbers.format(VOICE_PREVIEW_MAX_CHARACTERS)} ký tự
          </span>
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Mẫu gốc miễn phí nhưng không theo tốc độ, độ ổn định và ngôn ngữ ở trên. Nghe thử đọc đúng câu này với
        thiết lập hiện tại.
      </p>
      {preview.error ? <p className="text-sm text-destructive">{preview.error}</p> : null}
    </div>
  );
}
