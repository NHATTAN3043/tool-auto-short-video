"use client";

import { activeVoiceTrack, sceneVoiceStatus, type Project, type Scene } from "@studio/domain";
import { MicIcon } from "lucide-react";

import { projectFileUrl } from "@/features/media/api";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import type { VoiceJobsState } from "../hooks/use-voice-jobs";
import { canGenerate, jobCoversScene, VOICE_STATUS_LABELS } from "../model";

/** Voice row of a scene card: status, a player for the scene voice and "Tạo giọng". */
export function SceneVoiceControls({
  project,
  scene,
  jobs,
  generationEnabled,
}: {
  project: Project;
  scene: Scene;
  jobs: VoiceJobsState;
  /** False without TTS or with the voiceGeneration toggle off: only the existing voice is shown. */
  generationEnabled: boolean;
}) {
  const status = sceneVoiceStatus(project, scene);
  const voice = project.assets.find((asset) => asset.id === scene.voiceAssetId);
  if (!generationEnabled && !voice) return null;

  const label = VOICE_STATUS_LABELS[status];
  const generating = jobCoversScene(jobs.job, scene.id);
  const muted = voice !== undefined && activeVoiceTrack(project) === "project";

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
        {generationEnabled ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={!canGenerate(status) || generating || jobs.busy || project.voice === undefined}
            title={project.voice === undefined ? "Chọn giọng đọc ở mục Giọng đọc AI trước" : undefined}
            onClick={() => {
              void jobs.prepare([scene.id]);
            }}
          >
            <MicIcon />
            {status === "outdated" ? "Tạo lại giọng" : "Tạo giọng"}
          </Button>
        ) : null}
      </div>
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
