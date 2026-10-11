"use client";

import type { MediaAsset, Music } from "@studio/domain";
import { useId } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Slider } from "@/shared/ui/slider";

import { projectFileUrl } from "../api";
import { formatPercent } from "../format";
import { DEFAULT_MUSIC_VOLUME } from "../labels";
import { AudioSelect } from "./AudioSelect";

/** The one voice file for the whole video and the background music with its volume. */
export function AudioSettings({
  projectId,
  assets,
  voiceAssetId,
  music,
  onVoiceChange,
  onMusicChange,
  onCommit,
}: {
  projectId: string;
  assets: readonly MediaAsset[];
  voiceAssetId: string | undefined;
  music: Music | undefined;
  onVoiceChange: (assetId: string | null) => void;
  onMusicChange: (music: Music | null) => void;
  /** Ends a slider drag, so the drag is one undo step. */
  onCommit: () => void;
}) {
  const voiceId = useId();
  const musicId = useId();
  const audios = assets.filter((asset) => asset.kind === "audio");
  const voice = audios.find((asset) => asset.id === voiceAssetId);
  const song = audios.find((asset) => asset.id === music?.assetId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Âm thanh</CardTitle>
        <CardDescription>
          {audios.length === 0
            ? "Tải file mp3, wav hoặc m4a lên Thư viện media để chọn voice và nhạc nền."
            : "Voice đọc cho cả video và nhạc nền phía sau."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={voiceId}>Voice của dự án</Label>
          <AudioSelect id={voiceId} audios={audios} value={voiceAssetId} onChange={onVoiceChange} />
          {voice ? (
            <audio controls preload="none" src={projectFileUrl(projectId, voice.path)} className="w-full" />
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={musicId}>Nhạc nền</Label>
          <AudioSelect
            id={musicId}
            audios={audios}
            value={music?.assetId}
            onChange={(assetId) => {
              onMusicChange(
                assetId === null ? null : { assetId, volume: music?.volume ?? DEFAULT_MUSIC_VOLUME },
              );
            }}
          />
          {music && song ? (
            <>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Âm lượng</span>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[Math.round(music.volume * 100)]}
                  thumbLabels={["Âm lượng nhạc nền"]}
                  onValueChange={([value = 0]) => {
                    onMusicChange({ assetId: music.assetId, volume: value / 100 });
                  }}
                  onValueCommit={onCommit}
                />
                <span className="w-10 text-right font-mono text-sm">{formatPercent(music.volume)}</span>
              </div>
              <audio controls preload="none" src={projectFileUrl(projectId, song.path)} className="w-full" />
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
