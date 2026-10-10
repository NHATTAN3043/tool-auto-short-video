"use client";

import {
  countWords,
  type LibrarySfx,
  type MediaAsset,
  type Scene,
  type SceneMediaPatch,
  type SceneSfxPatch,
  type TimelineEntry,
  type VisualPlan,
} from "@studio/domain";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  MergeIcon,
  MonitorPlayIcon,
  PlusIcon,
  ScissorsIcon,
  Trash2Icon,
} from "lucide-react";
import type { ReactNode } from "react";

import { SceneMediaEditor } from "@/features/media";
import { SceneSfxEditor } from "@/features/sfx";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";

import { formatMs, formatSecondsInput } from "../format";
import { DURATION_SOURCE_LABELS } from "../labels";
import { DurationField } from "./DurationField";
import { VisualPlanEditor } from "./VisualPlanEditor";

export interface SceneCardActions {
  onNarrationChange: (sceneId: string, narration: string) => void;
  onNarrationBlur: () => void;
  onDurationCommit: (sceneId: string, durationMs: number | null) => void;
  onInsertAfter: (sceneId: string) => void;
  onDelete: (sceneId: string) => void;
  onMove: (sceneId: string, offset: -1 | 1) => void;
  onSplit: (sceneId: string) => void;
  onMergeNext: (sceneId: string) => void;
  onAssignMedia: (sceneId: string, assetId: string) => void;
  onMediaChange: (sceneId: string, patch: SceneMediaPatch) => void;
  onClearMedia: (sceneId: string) => void;
  /** Ends a slider drag in the media editor, so the drag is one undo step. */
  onMediaCommit: () => void;
  onAddSfx: (sceneId: string, librarySfxId: string) => Promise<void>;
  onSfxChange: (sceneId: string, sfxId: string, patch: SceneSfxPatch) => void;
  onRemoveSfx: (sceneId: string, sfxId: string) => void;
  /** Moves the preview to the start of this scene. */
  onPreviewScene: (sceneId: string) => void;
  onVisualPlanChange: (sceneId: string, visualPlan: VisualPlan | null) => void;
}

export function SceneCard({
  projectId,
  assets,
  sfxLibrary,
  scene,
  entry,
  isFirst,
  isLast,
  actions,
  voiceSlot,
  mediaSearchSlot,
}: {
  projectId: string;
  assets: readonly MediaAsset[];
  sfxLibrary: readonly LibrarySfx[];
  scene: Scene;
  entry: TimelineEntry;
  isFirst: boolean;
  isLast: boolean;
  actions: SceneCardActions;
  /** Scene voice controls, rendered under the duration row. */
  voiceSlot?: ReactNode;
  /** Media search for this scene, rendered under the media editor. */
  mediaSearchSlot?: ReactNode;
}) {
  const source = DURATION_SOURCE_LABELS[entry.source];
  const words = countWords(scene.narration);
  const durationId = `duration-${scene.id}`;

  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold">Cảnh {entry.index + 1}</span>
          <span className="font-mono text-sm text-muted-foreground">
            {formatMs(entry.startMs)} → {formatMs(entry.endMs)}
          </span>
          <Badge variant={entry.source === "estimate" ? "outline" : "secondary"} title={source.description}>
            {source.title}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Xem cảnh này"
            title="Xem cảnh này"
            onClick={() => {
              actions.onPreviewScene(scene.id);
            }}
          >
            <MonitorPlayIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Lên"
            title="Lên"
            disabled={isFirst}
            onClick={() => {
              actions.onMove(scene.id, -1);
            }}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Xuống"
            title="Xuống"
            disabled={isLast}
            onClick={() => {
              actions.onMove(scene.id, 1);
            }}
          >
            <ArrowDownIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Tách đôi cảnh"
            title="Tách đôi cảnh"
            disabled={words < 2}
            onClick={() => {
              actions.onSplit(scene.id);
            }}
          >
            <ScissorsIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Gộp với cảnh sau"
            title="Gộp với cảnh sau"
            disabled={isLast}
            onClick={() => {
              actions.onMergeNext(scene.id);
            }}
          >
            <MergeIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Thêm cảnh phía sau"
            title="Thêm cảnh phía sau"
            onClick={() => {
              actions.onInsertAfter(scene.id);
            }}
          >
            <PlusIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Xoá cảnh"
            title="Xoá cảnh"
            className="text-destructive"
            onClick={() => {
              actions.onDelete(scene.id);
            }}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      <Textarea
        aria-label={`Lời cảnh ${String(entry.index + 1)}`}
        value={scene.narration}
        placeholder="Lời đọc của cảnh…"
        onChange={(event) => {
          actions.onNarrationChange(scene.id, event.target.value);
        }}
        onBlur={actions.onNarrationBlur}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor={durationId} className="font-normal text-muted-foreground">
          Thời lượng (giây)
        </Label>
        <DurationField
          key={scene.durationMs ?? "auto"}
          id={durationId}
          durationMs={scene.durationMs}
          placeholder={`Tự động · ${formatSecondsInput(entry.durationMs)}`}
          onCommit={(durationMs) => {
            actions.onDurationCommit(scene.id, durationMs);
          }}
        />
        <span className="text-xs text-muted-foreground">{words} từ · để trống = tự tính</span>
      </div>

      {voiceSlot}

      {scene.visualPlan ? (
        <VisualPlanEditor
          sceneLabel={`Cảnh ${String(entry.index + 1)}`}
          visualPlan={scene.visualPlan}
          onChange={(visualPlan) => {
            actions.onVisualPlanChange(scene.id, visualPlan);
          }}
          onCommit={actions.onNarrationBlur}
        />
      ) : null}

      <SceneMediaEditor
        projectId={projectId}
        sceneLabel={`Cảnh ${String(entry.index + 1)}`}
        media={scene.media}
        assets={assets}
        actions={{
          onAssign: (assetId) => {
            actions.onAssignMedia(scene.id, assetId);
          },
          onChange: (patch) => {
            actions.onMediaChange(scene.id, patch);
          },
          onClear: () => {
            actions.onClearMedia(scene.id);
          },
          onCommit: actions.onMediaCommit,
        }}
      />

      {mediaSearchSlot}

      <SceneSfxEditor
        projectId={projectId}
        assets={assets}
        sfx={scene.sfx}
        library={sfxLibrary}
        actions={{
          onAdd: (librarySfxId) => actions.onAddSfx(scene.id, librarySfxId),
          onChange: (sfxId, patch) => {
            actions.onSfxChange(scene.id, sfxId, patch);
          },
          onRemove: (sfxId) => {
            actions.onRemoveSfx(scene.id, sfxId);
          },
          onCommit: actions.onMediaCommit,
        }}
      />
    </li>
  );
}
