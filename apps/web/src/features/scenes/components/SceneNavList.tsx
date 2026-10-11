"use client";

import { timelineDurationMs, type MediaAsset, type Project, type TimelineEntry } from "@studio/domain";
import {
  CircleCheckIcon,
  FilmIcon,
  ImageIcon,
  ImageOffIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";

import { projectFileUrl } from "@/features/media/api";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import { formatMs, formatSecondsInput } from "../format";
import { isSceneReady, sceneReadiness } from "../readiness";

type Filter = "all" | "todo";

function SceneThumb({ projectId, asset }: { projectId: string; asset: MediaAsset | undefined }) {
  if (!asset) {
    return (
      <span className="grid h-14 w-8 shrink-0 place-items-center rounded-md border border-dashed bg-background text-muted-foreground">
        <ImageOffIcon className="size-3.5" />
      </span>
    );
  }
  const Icon = asset.kind === "image" ? ImageIcon : FilmIcon;
  return (
    <span className="grid h-14 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground">
      {asset.thumbnailPath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={projectFileUrl(projectId, asset.thumbnailPath)}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <Icon className="size-3.5" />
      )}
    </span>
  );
}

/** Left column of the scene editor: every scene with what it still lacks; picking one opens it. */
export function SceneNavList({
  project,
  timeline,
  voiceRequired,
  selectedId,
  onSelect,
  onAppend,
  className,
}: {
  project: Project;
  timeline: readonly TimelineEntry[];
  voiceRequired: boolean;
  selectedId: string | null;
  onSelect: (sceneId: string) => void;
  /** Adds an empty scene at the end. */
  onAppend: () => void;
  className?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = project.scenes.map((scene, index) => {
    const readiness = sceneReadiness(project, scene, voiceRequired);
    return { scene, index, entry: timeline[index], readiness, ready: isSceneReady(readiness) };
  });
  const todoCount = rows.filter((row) => !row.ready).length;
  const visible = filter === "todo" ? rows.filter((row) => !row.ready) : rows;

  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col rounded-xl border bg-card", className)}>
      <div className="flex flex-col gap-3 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Cảnh</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {project.scenes.length} cảnh · {formatMs(timelineDurationMs(timeline))}
          </span>
        </div>
        <div
          className="inline-flex self-start rounded-md bg-muted p-[3px]"
          role="group"
          aria-label="Lọc cảnh"
        >
          {(
            [
              ["all", "Tất cả"],
              ["todo", `Cần xử lý · ${String(todoCount)}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              className="h-7 rounded-[5px] px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-background aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:shadow-sm"
              onClick={() => {
                setFilter(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Mọi cảnh đều đã đủ.</p>
      ) : (
        <ol className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {visible.map(({ scene, index, entry, readiness, ready }) => {
            const asset = scene.media ? project.assets.find((a) => a.id === scene.media?.assetId) : undefined;
            return (
              <li key={scene.id}>
                <button
                  type="button"
                  aria-current={scene.id === selectedId ? "true" : undefined}
                  className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current]:bg-accent aria-[current]:ring-1 aria-[current]:ring-border"
                  onClick={() => {
                    onSelect(scene.id);
                  }}
                >
                  <span className="w-5 shrink-0 pt-0.5 text-right text-xs text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <SceneThumb projectId={project.id} asset={asset} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span
                      className={cn(
                        "line-clamp-2 text-sm leading-5",
                        scene.narration.trim() === "" && "text-muted-foreground italic",
                      )}
                    >
                      {scene.narration.trim() === "" ? "Chưa có lời đọc" : scene.narration}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {entry ? (
                        <span className="tabular-nums">{formatSecondsInput(entry.durationMs)} giây</span>
                      ) : null}
                      {readiness.missing ? (
                        <Badge className="bg-warning-bg text-warning">
                          <TriangleAlertIcon />
                          {readiness.missing}
                        </Badge>
                      ) : null}
                      {readiness.voiceOutdated ? (
                        <Badge className="bg-warning-bg text-warning">Lời đã đổi, cần tạo lại giọng</Badge>
                      ) : null}
                      {ready ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CircleCheckIcon className="size-3" />
                          Đủ
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="border-t p-2">
        <Button variant="ghost" className="w-full" onClick={onAppend}>
          <PlusIcon />
          Thêm cảnh
        </Button>
      </div>
    </section>
  );
}
