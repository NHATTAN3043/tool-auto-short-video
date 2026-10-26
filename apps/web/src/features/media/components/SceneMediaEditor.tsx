"use client";

import { MediaFitSchema, type MediaAsset, type SceneMedia, type SceneMediaPatch } from "@studio/domain";
import { ImagePlusIcon, XIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

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
import { VideoSpeedControl } from "./VideoSpeedControl";

export interface SceneMediaActions {
  onAssign: (assetId: string) => void;
  onChange: (patch: SceneMediaPatch) => void;
  onClear: () => void;
  /** Ends a slider drag, so the drag is one undo step. */
  onCommit: () => void;
  /** "Khớp tốc độ với giọng" (ADR 0021). */
  onFitSpeed: () => void;
  onPlaybackRateChange: (playbackRate: number) => void;
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
  hasVoice,
  actions,
  renderLibraryPicker,
}: {
  projectId: string;
  sceneLabel: string;
  media: SceneMedia | undefined;
  assets: readonly MediaAsset[];
  /** The channel logo, never offered as a scene's picture. */
  logoAssetId?: string | undefined;
  /** The scene has its own voice, so its video can be fitted to it. */
  hasVoice: boolean;
  actions: SceneMediaActions;
  renderLibraryPicker?: (onPicked: () => void) => ReactNode;
}) {
  const [picking, setPicking] = useState(false);
  const [source, setSource] = useState<"project" | "library">(media ? "project" : "library");
  const pickerId = useId();
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
        {renderLibraryPicker ? (
          <div role="tablist" aria-label="Nguồn chọn media" className="flex gap-2">
            {(["project", "library"] as const).map((tab) => (
              <Button
                key={tab}
                id={`${pickerId}-${tab}`}
                role="tab"
                aria-selected={source === tab}
                aria-controls={`${pickerId}-panel`}
                tabIndex={source === tab ? 0 : -1}
                variant={source === tab ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  setSource(tab);
                }}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? "project"
                      : event.key === "End"
                        ? "library"
                        : source === "project"
                          ? "library"
                          : "project";
                  setSource(next);
                  document.getElementById(`${pickerId}-${next}`)?.focus();
                }}
              >
                {tab === "project" ? "File dự án" : "Kho chung"}
              </Button>
            ))}
          </div>
        ) : null}
        <div
          id={`${pickerId}-panel`}
          role={renderLibraryPicker ? "tabpanel" : undefined}
          aria-labelledby={renderLibraryPicker ? `${pickerId}-${source}` : undefined}
        >
          {source === "library" && renderLibraryPicker ? (
            renderLibraryPicker(() => {
              setPicking(false);
            })
          ) : (
            <MediaPicker projectId={projectId} visuals={visuals} selectedId={media?.assetId} onPick={pick} />
          )}
        </div>
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
            setSource("project");
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
          playbackRate={media.playbackRate ?? 1}
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

      {asset.kind === "video" ? (
        <VideoSpeedControl
          value={media.playbackRate ?? 1}
          canFitToVoice={hasVoice && (media.sourceEndMs ?? asset.durationMs ?? 0) > media.sourceStartMs}
          onChange={actions.onPlaybackRateChange}
          onCommit={actions.onCommit}
          onFitSpeed={actions.onFitSpeed}
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
