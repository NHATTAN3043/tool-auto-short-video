"use client";

import type { LibraryMedia } from "@studio/domain";
import { ListVideoIcon } from "lucide-react";
import { useState } from "react";

import { libraryFileUrl, shotFileUrl } from "@/features/media-search/model";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";

import { shotTime } from "../model";

/**
 * The shots of an analyzed library video: still, times, description, keywords. Clicking one plays that
 * stretch of the video, to check that the description matches.
 */
export function ShotsDialog({ item }: { item: LibraryMedia }) {
  const [playing, setPlaying] = useState<number | null>(null);
  const shots = item.analysis?.shots ?? [];
  const current = playing === null ? undefined : shots[playing];
  if (shots.length === 0) return null;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) setPlaying(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs">
          <ListVideoIcon />
          Xem đoạn
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{item.fileName}</DialogTitle>
          <DialogDescription>
            {shots.length} đoạn · phân tích bằng {item.analysis?.model}. Bấm một đoạn để xem lại đoạn đó.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {current ? (
            <video
              // A media fragment plays only that stretch; the key restarts it when another shot is picked.
              key={playing}
              src={`${libraryFileUrl(item.id, "media")}#t=${String(current.startMs / 1000)},${String(current.endMs / 1000)}`}
              controls
              autoPlay
              muted
              className="mx-auto max-h-80 rounded bg-black"
            />
          ) : null}
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {shots.map((shot) => (
              <li key={shot.index}>
                <button
                  type="button"
                  className="flex w-full gap-3 rounded-md border p-2 text-left hover:bg-muted data-[active=true]:border-primary"
                  data-active={playing === shot.index}
                  onClick={() => {
                    setPlaying(shot.index);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- local library still */}
                  <img
                    src={shotFileUrl(item.id, shot.index)}
                    alt=""
                    loading="lazy"
                    className="h-24 w-16 shrink-0 rounded bg-black object-contain"
                  />
                  <span className="flex min-w-0 flex-col gap-1 text-xs">
                    <span className="font-mono text-muted-foreground">
                      #{shot.index + 1} · {shotTime(shot.startMs)}–{shotTime(shot.endMs)}
                    </span>
                    <span className="text-sm">{shot.description}</span>
                    <span className="text-muted-foreground">{shot.tags.join(", ")}</span>
                    {shot.textOverlay ? (
                      <Badge variant="outline" className="self-start">
                        Có chữ/logo
                      </Badge>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
