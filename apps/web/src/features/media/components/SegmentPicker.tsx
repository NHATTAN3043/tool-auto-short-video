"use client";

import { PlayIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Slider } from "@/shared/ui/slider";
import { Switch } from "@/shared/ui/switch";

import { formatClockTenths } from "../format";
import { DEFAULT_SEGMENT_MS } from "../labels";
import {
  clampSegment,
  loopPosition,
  segmentFromSlider,
  setEdgeAt,
  sliderValues,
  type Segment,
} from "../segment";

const STEP_MS = 100;

/**
 * Picks the part of a video a scene plays. Takes and returns only `sourceStartMs` / `sourceEndMs`
 * (null = until the scene ends); the file itself is never cut.
 */
export function SegmentPicker({
  src,
  durationMs: probedDurationMs,
  value,
  onChange,
  onCommit,
}: {
  src: string;
  /** From the probe; when missing, the browser's reading of the file is used. */
  durationMs: number | undefined;
  value: Segment;
  onChange: (segment: Segment) => void;
  /** Ends a drag or a button press, so it becomes one undo step. */
  onCommit: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [loadedDurationMs, setLoadedDurationMs] = useState<number | null>(null);
  const openEndId = useId();
  const durationMs = probedDurationMs ?? loadedDurationMs;

  const seek = (ms: number) => {
    if (video.current) video.current.currentTime = ms / 1000;
  };
  const playheadMs = () => Math.round((video.current?.currentTime ?? 0) * 1000);
  const apply = (next: Segment) => {
    onChange(next);
    onCommit();
  };

  return (
    <div className="flex flex-col gap-3">
      <video
        ref={video}
        src={src}
        preload="metadata"
        controls
        playsInline
        className="aspect-video w-full rounded-md bg-black"
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration;
          if (Number.isFinite(seconds)) setLoadedDurationMs(Math.round(seconds * 1000));
          event.currentTarget.currentTime = value.sourceStartMs / 1000;
        }}
        onTimeUpdate={(event) => {
          if (event.currentTarget.paused) return;
          const jumpTo = loopPosition(playheadMs(), value);
          if (jumpTo !== null) seek(jumpTo);
        }}
      />

      {durationMs === null ? (
        <p className="text-sm text-muted-foreground">Đang đọc thời lượng video…</p>
      ) : (
        <>
          <Slider
            min={0}
            max={durationMs}
            step={STEP_MS}
            minStepsBetweenThumbs={1}
            value={sliderValues(value, durationMs)}
            thumbLabels={["Điểm bắt đầu", "Điểm kết thúc"]}
            onValueChange={(values) => {
              const next = segmentFromSlider(values, value, durationMs);
              seek(
                next.sourceStartMs !== value.sourceStartMs
                  ? next.sourceStartMs
                  : (next.sourceEndMs ?? durationMs),
              );
              onChange(next);
            }}
            onValueCommit={onCommit}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-sm">
            <span>
              {formatClockTenths(value.sourceStartMs)} →{" "}
              {value.sourceEndMs === null ? "hết cảnh" : formatClockTenths(value.sourceEndMs)}
            </span>
            {value.sourceEndMs !== null ? (
              <span className="text-muted-foreground">
                dài {formatClockTenths(value.sourceEndMs - value.sourceStartMs)}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                apply(setEdgeAt(value, "start", playheadMs(), durationMs));
              }}
            >
              Đầu = vị trí đang xem
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                apply(setEdgeAt(value, "end", playheadMs(), durationMs));
              }}
            >
              Cuối = vị trí đang xem
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                seek(value.sourceStartMs);
                void video.current?.play();
              }}
            >
              <PlayIcon />
              Xem đoạn
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Switch
                id={openEndId}
                size="sm"
                checked={value.sourceEndMs === null}
                onCheckedChange={(openEnd) => {
                  apply(
                    clampSegment(
                      {
                        sourceStartMs: value.sourceStartMs,
                        sourceEndMs: openEnd ? null : value.sourceStartMs + DEFAULT_SEGMENT_MS,
                      },
                      durationMs,
                    ),
                  );
                }}
              />
              <Label htmlFor={openEndId} className="font-normal">
                Chạy tới hết cảnh
              </Label>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
