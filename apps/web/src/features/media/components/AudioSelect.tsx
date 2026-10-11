"use client";

import type { MediaAsset } from "@studio/domain";

import { formatClock } from "../format";

const NONE = "";

/** `giong-canh-03.mp3 (0:04)` */
export function audioOptionLabel(asset: MediaAsset): string {
  return `${asset.fileName}${asset.durationMs !== undefined ? ` (${formatClock(asset.durationMs)})` : ""}`;
}

/** Picks one audio asset of the project, or none. */
export function AudioSelect({
  id,
  audios,
  value,
  onChange,
  noneLabel = "Không dùng",
  optionLabel = audioOptionLabel,
}: {
  id: string;
  audios: readonly MediaAsset[];
  value: string | undefined;
  onChange: (assetId: string | null) => void;
  noneLabel?: string;
  optionLabel?: (asset: MediaAsset) => string;
}) {
  return (
    <select
      id={id}
      className="h-9 w-full min-w-0 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      value={value ?? NONE}
      onChange={(event) => {
        onChange(event.target.value === NONE ? null : event.target.value);
      }}
    >
      <option value={NONE}>{noneLabel}</option>
      {audios.map((asset) => (
        <option key={asset.id} value={asset.id}>
          {optionLabel(asset)}
        </option>
      ))}
    </select>
  );
}
