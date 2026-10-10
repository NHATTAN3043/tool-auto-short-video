"use client";

import {
  timelineDurationMs,
  type LibrarySfx,
  type MediaAsset,
  type Scene,
  type TimelineEntry,
} from "@studio/domain";
import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

import { formatMs } from "../format";
import { SceneCard, type SceneCardActions } from "./SceneCard";

export function SceneList({
  projectId,
  assets,
  sfxLibrary,
  scenes,
  timeline,
  actions,
  onInsertFirst,
  renderVoice,
  renderMediaSearch,
}: {
  projectId: string;
  assets: readonly MediaAsset[];
  sfxLibrary: readonly LibrarySfx[];
  scenes: readonly Scene[];
  timeline: readonly TimelineEntry[];
  actions: SceneCardActions;
  onInsertFirst: () => void;
  renderVoice?: (scene: Scene) => ReactNode;
  renderMediaSearch?: (scene: Scene, sceneLabel: string) => ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Cảnh</CardTitle>
          <CardDescription>
            {scenes.length} cảnh · tổng {formatMs(timelineDurationMs(timeline))}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onInsertFirst}>
          <PlusIcon />
          Thêm cảnh đầu
        </Button>
      </CardHeader>
      <CardContent>
        {scenes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa có cảnh. Dán script rồi bấm “Tách cảnh”, hoặc thêm cảnh thủ công.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {scenes.map((scene, index) => {
              const entry = timeline[index];
              if (!entry) return null;
              return (
                <SceneCard
                  key={scene.id}
                  projectId={projectId}
                  assets={assets}
                  sfxLibrary={sfxLibrary}
                  scene={scene}
                  entry={entry}
                  isFirst={index === 0}
                  isLast={index === scenes.length - 1}
                  actions={actions}
                  voiceSlot={renderVoice?.(scene)}
                  mediaSearchSlot={renderMediaSearch?.(scene, `Cảnh ${String(index + 1)}`)}
                />
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
