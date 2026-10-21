"use client";

import {
  WatermarkCornerSchema,
  type MediaAsset,
  type StylePatch,
  type Watermark,
  type WatermarkCorner,
} from "@studio/domain";
import { Trash2Icon, UploadIcon } from "lucide-react";
import { useCallback, useId, useRef } from "react";

import { AudioSelect, useMediaUploads } from "@/features/media";
import { projectFileUrl } from "@/features/media/api";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";

import { LOGO_ACCEPT, WATERMARK_CORNER_LABELS, WATERMARK_LIMITS } from "../labels";
import { SliderRow } from "./SliderRow";

const CORNER_PLACEMENT: Record<WatermarkCorner, string> = {
  "top-left": "top-1.5 left-1.5",
  "top-right": "top-1.5 right-1.5",
  "bottom-left": "bottom-1.5 left-1.5",
  "bottom-right": "bottom-1.5 right-1.5",
};

const percent = (fraction: number) => Math.round(fraction * 100);

/** A tiny 9:16 frame with one button per corner. */
function CornerPicker({
  value,
  disabled,
  onChange,
}: {
  value: WatermarkCorner;
  disabled: boolean;
  onChange: (corner: WatermarkCorner) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Góc đặt logo"
      className="relative aspect-[9/16] w-24 shrink-0 rounded-md border bg-muted"
    >
      {WatermarkCornerSchema.options.map((corner) => (
        <button
          key={corner}
          type="button"
          role="radio"
          aria-checked={value === corner}
          aria-label={WATERMARK_CORNER_LABELS[corner]}
          title={WATERMARK_CORNER_LABELS[corner]}
          disabled={disabled}
          onClick={() => {
            onChange(corner);
          }}
          className={cn(
            "absolute size-6 rounded-full border-2 transition-colors disabled:opacity-50",
            CORNER_PLACEMENT[corner],
            value === corner
              ? "border-primary bg-primary"
              : "border-muted-foreground/40 bg-background hover:border-primary",
          )}
        />
      ))}
    </div>
  );
}

/** The channel logo: a circle in one corner for the whole video, to make reposts carry the channel. */
export function WatermarkSettings({
  projectId,
  assets,
  watermark,
  onAssetAdded,
  onChange,
  onCommit,
}: {
  projectId: string;
  assets: readonly MediaAsset[];
  watermark: Watermark | undefined;
  onAssetAdded: (asset: MediaAsset) => void;
  onChange: (patch: StylePatch) => void;
  /** Ends a slider drag, so the drag is one undo step. */
  onCommit: () => void;
}) {
  const enabledId = useId();
  const imageId = useId();
  const input = useRef<HTMLInputElement>(null);
  const images = assets.filter((asset) => asset.kind === "image");
  const logo = images.find((asset) => asset.id === watermark?.assetId);
  const off = !watermark?.enabled;

  const apply = (patch: StylePatch) => {
    onChange(patch);
    onCommit();
  };
  const setLogo = (patch: Partial<Watermark>) => {
    onChange({ watermark: patch });
  };

  const onUploaded = useCallback(
    (asset: MediaAsset) => {
      onAssetAdded(asset);
      if (asset.kind === "image") {
        onChange({ watermark: { assetId: asset.id, enabled: true } });
        onCommit();
      }
    },
    [onAssetAdded, onChange, onCommit],
  );
  const uploads = useMediaUploads(projectId, onUploaded);
  const failed = uploads.items.filter((item) => item.status === "error").at(-1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo kênh</CardTitle>
        <CardDescription>
          Logo hình tròn ở một góc, hiện suốt video để video bị đăng lại vẫn mang tên kênh. Nên dùng ảnh vuông
          PNG; ảnh gốc không bị cắt.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {logo ? (
            // Plain <img>: the file comes from our own API route, next/image optimisation adds nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={projectFileUrl(projectId, logo.path)}
              alt="Logo kênh"
              className="size-14 shrink-0 rounded-full border object-cover"
            />
          ) : null}
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <Label htmlFor={imageId}>Ảnh logo</Label>
            <AudioSelect
              id={imageId}
              audios={images}
              value={watermark?.assetId}
              noneLabel="Không dùng logo"
              optionLabel={(asset) => asset.fileName}
              onChange={(assetId) => {
                apply({ watermark: assetId === null ? null : { assetId } });
              }}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="self-end"
            disabled={uploads.busy}
            onClick={() => {
              input.current?.click();
            }}
          >
            <UploadIcon />
            {uploads.busy ? "Đang tải lên…" : "Tải logo lên"}
          </Button>
          {watermark ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-end"
              onClick={() => {
                apply({ watermark: null });
              }}
            >
              <Trash2Icon />
              Bỏ logo
            </Button>
          ) : null}
          <input
            ref={input}
            type="file"
            accept={LOGO_ACCEPT}
            className="hidden"
            aria-label="Chọn ảnh logo"
            onChange={(event) => {
              if (event.target.files) uploads.addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
        {failed?.error ? <p className="text-sm text-destructive">{failed.error}</p> : null}

        {watermark ? (
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex flex-col items-center gap-2">
              <CornerPicker
                value={watermark.corner}
                disabled={off}
                onChange={(corner) => {
                  apply({ watermark: { corner } });
                }}
              />
              <span className="text-xs text-muted-foreground">
                {WATERMARK_CORNER_LABELS[watermark.corner]}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id={enabledId}
                  checked={watermark.enabled}
                  onCheckedChange={(enabled) => {
                    apply({ watermark: { enabled } });
                  }}
                />
                <Label htmlFor={enabledId}>Hiện logo</Label>
              </div>
              <SliderRow
                label="Kích thước"
                value={percent(watermark.size)}
                display={`${String(percent(watermark.size))}%`}
                {...WATERMARK_LIMITS.sizePercent}
                disabled={off}
                onChange={(value) => {
                  setLogo({ size: value / 100 });
                }}
                onCommit={onCommit}
              />
              <SliderRow
                label="Cách mép ngang"
                value={percent(watermark.offsetX)}
                display={`${String(percent(watermark.offsetX))}%`}
                {...WATERMARK_LIMITS.offsetPercent}
                disabled={off}
                onChange={(value) => {
                  setLogo({ offsetX: value / 100 });
                }}
                onCommit={onCommit}
              />
              <SliderRow
                label="Cách mép dọc"
                value={percent(watermark.offsetY)}
                display={`${String(percent(watermark.offsetY))}%`}
                {...WATERMARK_LIMITS.offsetPercent}
                disabled={off}
                onChange={(value) => {
                  setLogo({ offsetY: value / 100 });
                }}
                onCommit={onCommit}
              />
              <SliderRow
                label="Độ rõ"
                value={percent(watermark.opacity)}
                display={`${String(percent(watermark.opacity))}%`}
                {...WATERMARK_LIMITS.opacityPercent}
                disabled={off}
                onChange={(value) => {
                  setLogo({ opacity: value / 100 });
                }}
                onCommit={onCommit}
              />
              <SliderRow
                label="Viền trắng"
                value={watermark.borderWidth}
                display={`${String(watermark.borderWidth)}px`}
                {...WATERMARK_LIMITS.borderWidth}
                disabled={off}
                onChange={(borderWidth) => {
                  setLogo({ borderWidth });
                }}
                onCommit={onCommit}
              />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
