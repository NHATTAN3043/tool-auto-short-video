"use client";

import {
  ACCEPTED_EXTENSIONS,
  activeVoiceTrack,
  mediaKindFromFileName,
  sceneVoiceStatus,
  type MediaAsset,
  type Project,
  type Scene,
} from "@studio/domain";
import { MicIcon, UploadIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { AudioSelect } from "@/features/media";
import { projectFileUrl, uploadAsset, type UploadHandle } from "@/features/media/api";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import type { VoiceJobsState } from "../hooks/use-voice-jobs";
import {
  jobCoversScene,
  sceneVoiceChoices,
  sceneVoiceOptionLabel,
  VOICE_STATUS_LABELS,
  voiceAction,
  voiceButtonBlock,
} from "../model";

const AUDIO_ACCEPT = ACCEPTED_EXTENSIONS.audio.map((extension) => `.${extension}`).join(",");

/** Lets the user pick, upload or clear the scene's own voice file. Without it the row only shows the voice. */
export interface SceneVoicePicker {
  onChange: (voiceAssetId: string | null) => void;
  /** An uploaded file is now an asset of the project. */
  onAssetAdded: (asset: MediaAsset) => void;
}

/** Uploads one audio file for a scene; aborted when the row goes away. */
function useSceneVoiceUpload(projectId: string, picker: SceneVoicePicker | undefined) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<UploadHandle | null>(null);
  useEffect(() => () => handleRef.current?.abort(), []);

  const upload = (file: File) => {
    if (!picker) return;
    if (mediaKindFromFileName(file.name) !== "audio") {
      setError(`Chỉ nhận file âm thanh ${ACCEPTED_EXTENSIONS.audio.join(", ")}.`);
      return;
    }
    setError(null);
    setProgress(0);
    const handle = uploadAsset(projectId, file, setProgress);
    handleRef.current = handle;
    handle.promise
      .then(({ asset }) => {
        picker.onAssetAdded(asset);
        picker.onChange(asset.id);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Tải lên thất bại.");
      })
      .finally(() => {
        handleRef.current = null;
        setProgress(null);
      });
  };
  return { progress, error, upload };
}

/** Voice row of a scene card: status, the scene's voice file (pick, upload, clear) and "Tạo giọng". */
export function SceneVoiceControls({
  project,
  scene,
  jobs,
  generationEnabled,
  picker,
  startVoice = null,
}: {
  project: Project;
  scene: Scene;
  jobs: VoiceJobsState;
  /** False without TTS or with the voiceGeneration toggle off: only the existing voice is shown. */
  generationEnabled: boolean;
  picker?: SceneVoicePicker;
  /**
   * Gives a project without voice settings its default voice (saved) before the first run, like Full AI
   * does. Null while the voice list is loading or when the account has no voice.
   */
  startVoice?: (() => Promise<void>) | null;
}) {
  const selectId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploads = useSceneVoiceUpload(project.id, picker);
  const status = sceneVoiceStatus(project, scene);
  const voice = project.assets.find((asset) => asset.id === scene.voiceAssetId);
  if (!generationEnabled && !voice && !picker) return null;

  const label = VOICE_STATUS_LABELS[status];
  const action = voiceAction(status);
  const generating = jobCoversScene(jobs.job, scene.id);
  const muted = voice !== undefined && activeVoiceTrack(project) === "project";
  const uploading = uploads.progress !== null;
  const blocked = voiceButtonBlock(project.voice !== undefined, startVoice !== null);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Giọng cảnh</span>
        <Badge variant={label.tone} title={label.description}>
          {generating ? "Đang tạo…" : label.title}
        </Badge>
        {muted ? (
          <span className="text-xs text-muted-foreground">(đang tắt: dự án phát voice chung)</span>
        ) : null}
        {generationEnabled && action ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={generating || jobs.busy || blocked !== null}
            title={blocked ?? undefined}
            onClick={() => {
              void jobs.prepare([scene.id], {
                regenerate: action.regenerate,
                ...(project.voice === undefined && startVoice !== null && { before: startVoice }),
              });
            }}
          >
            <MicIcon />
            {action.label}
          </Button>
        ) : null}
      </div>

      {picker ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="sr-only">
            File giọng của cảnh
          </label>
          <div className="min-w-0 flex-1 basis-56">
            <AudioSelect
              id={selectId}
              audios={sceneVoiceChoices(project.assets)}
              value={scene.voiceAssetId}
              onChange={picker.onChange}
              noneLabel="Chưa có giọng cho cảnh"
              optionLabel={sceneVoiceOptionLabel}
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={AUDIO_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) uploads.upload(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <UploadIcon />
            {uploading ? `Đang tải… ${String(Math.round((uploads.progress ?? 0) * 100))}%` : "Tải file lên"}
          </Button>
          {scene.voiceAssetId !== undefined ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Bỏ giọng của cảnh"
              title="Bỏ giọng của cảnh"
              onClick={() => {
                picker.onChange(null);
              }}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      ) : null}
      {jobs.error && jobs.errorScenes?.includes(scene.id) === true ? (
        <p role="alert" className="text-sm text-destructive">
          {jobs.error}
        </p>
      ) : null}
      {uploads.error ? (
        <p role="alert" className="text-sm text-destructive">
          {uploads.error}
        </p>
      ) : null}

      {voice ? (
        <audio
          key={voice.id}
          controls
          preload="none"
          src={projectFileUrl(project.id, voice.path)}
          className="h-8 w-full"
        />
      ) : null}
    </div>
  );
}
