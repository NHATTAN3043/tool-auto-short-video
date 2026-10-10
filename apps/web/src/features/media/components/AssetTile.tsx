"use client";

import type { MediaAsset } from "@studio/domain";
import { FilmIcon, ImageIcon, MusicIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";

import { projectFileUrl } from "../api";
import { formatClock, formatResolution } from "../format";
import { KIND_LABELS } from "../labels";

const KIND_ICONS = { video: FilmIcon, image: ImageIcon, audio: MusicIcon } as const;

export function AssetThumbnail({
  projectId,
  asset,
  className,
}: {
  projectId: string;
  asset: MediaAsset;
  className?: string;
}) {
  const Icon = KIND_ICONS[asset.kind];
  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-md bg-muted", className)}>
      {asset.thumbnailPath ? (
        // Plain <img>: thumbnails come from our own API route, next/image optimisation adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={projectFileUrl(projectId, asset.thumbnailPath)}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Icon className="size-6" />
        </div>
      )}
      {asset.durationMs !== undefined ? (
        <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[11px] text-white">
          {formatClock(asset.durationMs)}
        </span>
      ) : null}
    </div>
  );
}

/** One asset in a grid: thumbnail, name, kind and resolution. Clickable when `onSelect` is given. */
export function AssetTile({
  projectId,
  asset,
  selected = false,
  onSelect,
}: {
  projectId: string;
  asset: MediaAsset;
  selected?: boolean;
  onSelect?: (assetId: string) => void;
}) {
  const resolution = formatResolution(asset);
  const body = (
    <>
      <AssetThumbnail projectId={projectId} asset={asset} />
      <span className="truncate text-left text-xs font-medium" title={asset.fileName}>
        {asset.fileName}
      </span>
      <span className="text-left text-[11px] text-muted-foreground">
        {KIND_LABELS[asset.kind]}
        {resolution ? ` · ${resolution}` : ""}
      </span>
    </>
  );
  const className = cn(
    "flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-1.5",
    selected && "border-primary ring-2 ring-primary/40",
  );
  if (!onSelect) return <li className={className}>{body}</li>;
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-pressed={selected}
        className={cn(className, "w-full transition-colors hover:border-primary/60")}
        onClick={() => {
          onSelect(asset.id);
        }}
      >
        {body}
      </button>
    </li>
  );
}
