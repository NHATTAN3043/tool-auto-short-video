"use client";

import { MediaFitSchema, type MediaAsset, type SceneMedia, type SceneMediaPatch } from "@studio/domain";
import { ImagePlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { Slider } from "@/shared/ui/slider";
import { Switch } from "@/shared/ui/switch";

import { projectFileUrl } from "../api";
import { formatPercent } from "../format";
import { FIT_LABELS } from "../labels";
import { AssetThumbnail, AssetTile } from "./AssetTile";
import { SegmentPicker } from "./SegmentPicker";

export interface SceneMediaActions {
  onAssign: (assetId: string) => void;
  onChange: (patch: SceneMediaPatch) => void;
  onClear: () => void;
  /** Ends a slider drag, so the drag is one undo step. */
  onCommit: () => void;
}

function PercentSlider({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      <Slider
        min={0}
        max={100}
        step={1}
        value={[Math.round(value * 100)]}
        thumbLabels={[label]}
        onValueChange={([next = 0]) => {
          onChange(next / 100);
        }}
        onValueCommit={onCommit}
      />
      <span className="w-10 text-right font-mono text-sm">{formatPercent(value)}</span>
    </div>
  );
}

function MediaPicker({
  projectId,
  visuals,
  selectedId,
  onPick,
}: {
  projectId: string;
  visuals: readonly MediaAsset[];
  selectedId: string | undefined;
  onPick: (assetId: string) => void;
}) {
  if (visuals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Chưa có video hoặc ảnh. Tải lên ở Thư viện media trước.</p>
    );
  }
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {visuals.map((asset) => (
        <AssetTile
          key={asset.id}
          projectId={projectId}
          asset={asset}
          selected={asset.id === selectedId}
          onSelect={onPick}
        />
      ))}
    </ul>
  );
}

/** The visual of one scene: which asset, which part of it, and how it fills the vertical frame. */
export function SceneMediaEditor({
  projectId,
  sceneLabel,
  media,
  assets,
  logoAssetId,
  actions,
}: {
  projectId: string;
  sceneLabel: string;
  media: SceneMedia | undefined;
  assets: readonly MediaAsset[];
  /** The channel logo, never offered as a scene's picture. */
  logoAssetId?: string | undefined;
  actions: SceneMediaActions;
}) {
  const [picking, setPicking] = useState(false);
  const fitName = useId();
  const kenBurnsId = useId();
  const visuals = assets.filter((asset) => asset.kind !== "audio" && asset.id !== logoAssetId);
  const asset = media ? assets.find((candidate) => candidate.id === media.assetId) : undefined;

  const pick = (assetId: string) => {
    setPicking(false);
    actions.onAssign(assetId);
  };

  if (!media || picking) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Chọn media cho {sceneLabel}</span>
          {media ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setPicking(false);
              }}
            >
              Huỷ
            </Button>
          ) : null}
        </div>
        <MediaPicker projectId={projectId} visuals={visuals} selectedId={media?.assetId} onPick={pick} />
      </div>
    );
  }

  if (!asset) {
    return (
      <div role="alert" className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
        <span className="text-destructive">Không tìm thấy file media của cảnh này.</span>
        <Button variant="outline" size="xs" onClick={actions.onClear}>
          Bỏ media
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center gap-3">
        <AssetThumbnail projectId={projectId} asset={asset} className="w-24 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={asset.fileName}>
          {asset.fileName}
        </span>
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            setPicking(true);
          }}
        >
          <ImagePlusIcon />
          Đổi
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Bỏ media"
          title="Bỏ media"
          onClick={actions.onClear}
        >
          <XIcon />
        </Button>
      </div>

      {asset.kind === "video" ? (
        <SegmentPicker
          src={projectFileUrl(projectId, asset.path)}
          durationMs={asset.durationMs}
          value={{ sourceStartMs: media.sourceStartMs, sourceEndMs: media.sourceEndMs ?? null }}
          onChange={(segment) => {
            actions.onChange(segment);
          }}
          onCommit={actions.onCommit}
        />
      ) : null}

      <RadioGroup
        value={media.fit}
        onValueChange={(next) => {
          actions.onChange({ fit: MediaFitSchema.parse(next) });
          actions.onCommit();
        }}
        className="grid gap-2 sm:grid-cols-2"
      >
        {MediaFitSchema.options.map((fit) => (
          <Label
            key={fit}
            htmlFor={`${fitName}-${fit}`}
            className="flex cursor-pointer flex-col items-start gap-0.5 rounded-md border p-2 font-normal has-[[data-state=checked]]:border-primary"
          >
            <span className="flex items-center gap-2 font-medium">
              <RadioGroupItem id={`${fitName}-${fit}`} value={fit} />
              {FIT_LABELS[fit].title}
            </span>
            <span className="text-xs text-muted-foreground">{FIT_LABELS[fit].description}</span>
          </Label>
        ))}
      </RadioGroup>

      {media.fit === "cover" ? (
        <PercentSlider
          label="Vị trí ngang"
          value={media.focusX}
          onChange={(focusX) => {
            actions.onChange({ focusX });
          }}
          onCommit={actions.onCommit}
        />
      ) : null}

      {asset.kind === "video" && asset.hasAudio !== false ? (
        <PercentSlider
          label="Âm lượng gốc"
          value={media.volume}
          onChange={(volume) => {
            actions.onChange({ volume });
          }}
          onCommit={actions.onCommit}
        />
      ) : null}

      {asset.kind === "image" ? (
        <div className="flex items-center gap-2">
          <Switch
            id={kenBurnsId}
            size="sm"
            checked={media.kenBurns}
            onCheckedChange={(kenBurns) => {
              actions.onChange({ kenBurns });
              actions.onCommit();
            }}
          />
          <Label htmlFor={kenBurnsId} className="font-normal">
            Zoom chậm (Ken Burns)
          </Label>
        </div>
      ) : null}
    </div>
  );
}
