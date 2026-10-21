"use client";

import type { MediaAsset } from "@studio/domain";
import { CheckIcon, CircleAlertIcon, LoaderIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

import { formatBytes, formatPercent } from "../format";
import { useMediaUploads } from "../hooks/use-media-uploads";
import { ACCEPT_ATTRIBUTE, type UploadItem } from "../uploads";
import { AssetTile } from "./AssetTile";

function UploadRow({ item }: { item: UploadItem }) {
  return (
    <li className="flex flex-col gap-1 text-sm">
      <div className="flex items-center gap-2">
        {item.status === "done" ? (
          <CheckIcon className="size-4 text-emerald-600" />
        ) : item.status === "error" ? (
          <CircleAlertIcon className="size-4 text-destructive" />
        ) : (
          <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate" title={item.fileName}>
          {item.fileName}
        </span>
        <span className="text-xs text-muted-foreground">
          {item.status === "uploading" ? formatPercent(item.progress) : formatBytes(item.size)}
        </span>
      </div>
      {item.status === "uploading" ? (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: formatPercent(item.progress) }}
          />
        </div>
      ) : null}
      {item.error ? <p className="text-xs text-destructive">{item.error}</p> : null}
    </li>
  );
}

/** Project media: drop or pick several files, watch them upload, browse what is already there. */
export function MediaLibrary({
  projectId,
  assets,
  onUploaded,
}: {
  projectId: string;
  assets: readonly MediaAsset[];
  onUploaded: (asset: MediaAsset) => void;
}) {
  const uploads = useMediaUploads(projectId, onUploaded);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const finished = uploads.items.filter((item) => item.status === "done" || item.status === "error");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thư viện media</CardTitle>
        <CardDescription>
          Video (mp4, mov, webm), ảnh (jpg, png, webp) và âm thanh (mp3, wav, m4a). File gốc được giữ nguyên.
        </CardDescription>
        <CardDescription>
          Đặt tên file theo nội dung để Full AI và ô tìm media tìm thấy: các tag cách nhau bằng{" "}
          <code>__</code>, các từ trong tag cách nhau bằng <code>-</code>, nên có tag tiếng Anh. Ví dụ{" "}
          <code>cat-sleeping__orange-cat__sofa.mp4</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm text-muted-foreground transition-colors",
            dragging && "border-primary bg-primary/5",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => {
            setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            uploads.addFiles(event.dataTransfer.files);
          }}
        >
          <UploadIcon className="size-6" />
          <p>Kéo thả file vào đây</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              input.current?.click();
            }}
          >
            Chọn file…
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="hidden"
            aria-label="Chọn file media"
            onChange={(event) => {
              if (event.target.files) uploads.addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {uploads.items.length > 0 ? (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {uploads.items.map((item) => (
                <UploadRow key={item.id} item={item} />
              ))}
            </ul>
            {finished.length > 0 ? (
              <Button variant="ghost" size="xs" className="self-end" onClick={uploads.clearFinished}>
                Ẩn các file đã xong
              </Button>
            ) : null}
          </div>
        ) : null}

        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có file nào.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {assets.map((asset) => (
              <AssetTile key={asset.id} projectId={projectId} asset={asset} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
