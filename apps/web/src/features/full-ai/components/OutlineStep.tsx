"use client";

import {
  hasCurrentVisualPlan,
  isLongOutlineScene,
  outlineSceneSeconds,
  type FullAiDraft,
  type OutlineScene,
} from "@studio/domain";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClapperboardIcon,
  ImageIcon,
  Loader2Icon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

import { outlineSceneLabel, outlineTotals } from "../model";
import { Skeleton, StudioEmpty, StudioError, StudioLoading } from "./studio-parts";

/** A suggested rewrite of one scene, applied only when the user takes it. */
export interface RewriteState {
  sceneId: string;
  busy: boolean;
  narration?: string;
  error?: string;
}

export interface OutlineActions {
  onEdit: (sceneId: string, narration: string) => void;
  onMove: (sceneId: string, delta: -1 | 1) => void;
  onRemove: (sceneId: string) => void;
  onAdd: () => void;
  onRewrite: (sceneId: string) => void;
  onTakeRewrite: () => void;
  onDropRewrite: () => void;
  onRegenerate: (feedback: string) => void;
}

function OutlineSceneCard({
  scene,
  index,
  count,
  rewrite,
  actions,
}: {
  scene: OutlineScene;
  index: number;
  count: number;
  rewrite: RewriteState | null;
  actions: OutlineActions;
}) {
  const long = isLongOutlineScene(scene.narration);
  // An edited scene gets a new visual plan from the AI when the video is made.
  const intent = hasCurrentVisualPlan(scene) ? (scene.visualPlan?.intent ?? null) : null;
  const mine = rewrite?.sceneId === scene.id ? rewrite : null;
  return (
    <li className={cn("rounded-lg border bg-card", long && "border-warning/40")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5">
        <span className="grid size-6 place-items-center rounded-md bg-muted text-xs font-medium tabular-nums">
          {index + 1}
        </span>
        <span className="text-sm font-medium">{outlineSceneLabel(index, count)}</span>
        <span
          className={cn("text-xs tabular-nums", long ? "font-medium text-warning" : "text-muted-foreground")}
        >
          ≈ {outlineSceneSeconds(scene.narration)} giây
        </span>
        {long ? (
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-warning-bg px-2 text-xs font-medium text-warning">
            <TriangleAlertIcon className="size-3" />
            Dài, nên tách đôi
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={rewrite?.busy === true || scene.narration.trim() === ""}
            onClick={() => {
              actions.onRewrite(scene.id);
            }}
          >
            {mine?.busy ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />}
            Viết lại
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Đưa lên"
            title="Đưa lên"
            disabled={index === 0}
            onClick={() => {
              actions.onMove(scene.id, -1);
            }}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Đưa xuống"
            title="Đưa xuống"
            disabled={index === count - 1}
            onClick={() => {
              actions.onMove(scene.id, 1);
            }}
          >
            <ArrowDownIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Xoá cảnh"
            title="Xoá cảnh"
            onClick={() => {
              actions.onRemove(scene.id);
            }}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <Textarea
          className="min-h-9 resize-none bg-background"
          maxLength={5000}
          aria-label={`Lời đọc cảnh ${String(index + 1)}`}
          placeholder="Lời đọc của cảnh"
          value={scene.narration}
          onChange={(event) => {
            actions.onEdit(scene.id, event.target.value);
          }}
        />
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ImageIcon className="mt-px size-3.5 shrink-0" />
          <span className="text-pretty">
            {intent === null ? "Hình: AI gợi ý khi tạo video" : `Hình: ${intent}`}
          </span>
        </p>
        {mine?.narration !== undefined ? (
          <div className="flex flex-col gap-2 rounded-md bg-muted/60 p-3">
            <span className="text-xs font-medium text-muted-foreground">Gợi ý viết lại</span>
            <p className="text-sm text-pretty">{mine.narration}</p>
            <span className="flex flex-wrap gap-2">
              <Button size="sm" onClick={actions.onTakeRewrite}>
                Dùng bản này
              </Button>
              <Button variant="ghost" size="sm" onClick={actions.onDropRewrite}>
                Bỏ
              </Button>
            </span>
          </div>
        ) : null}
        {mine?.error !== undefined ? (
          <StudioError message={mine.error}>
            <Button variant="ghost" size="sm" onClick={actions.onDropRewrite}>
              Đóng
            </Button>
          </StudioError>
        ) : null}
      </div>
    </li>
  );
}

/** Third step: the outline to read and edit, scene by scene, before anything paid runs. */
export function OutlineStep({
  draft,
  busy,
  rewrite,
  actions,
}: {
  draft: FullAiDraft;
  busy: boolean;
  rewrite: RewriteState | null;
  actions: OutlineActions;
}) {
  if (busy) {
    return (
      <StudioLoading label="AI đang viết khung kịch bản, thường mất 10–20 giây…">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="rounded-lg border">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Skeleton className="size-6" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </StudioLoading>
    );
  }
  const outline = draft.outline;
  if (!outline) return null;
  const totals = outlineTotals(draft);
  const count = outline.scenes.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Tiêu đề AI đề xuất</p>
          <h3 className="text-base font-semibold text-balance">{outline.title || "Chưa có tiêu đề"}</h3>
        </div>
        <p className="text-sm tabular-nums">
          <span className="text-muted-foreground">{totals.scenes} cảnh&nbsp;· </span>
          <span className={cn("font-medium", totals.overTarget && "text-warning")}>
            ≈ {totals.seconds} giây
          </span>
          <span className="text-muted-foreground"> / mục tiêu {draft.targetDurationSec} giây</span>
        </p>
      </div>
      {count === 0 ? (
        <StudioEmpty
          icon={<ClapperboardIcon />}
          title="Chưa có cảnh nào"
          description="Bạn đã xoá hết cảnh. Thêm cảnh tay hoặc nhờ AI làm lại khung."
        >
          <Button variant="outline" size="sm" onClick={actions.onAdd}>
            <PlusIcon />
            Thêm cảnh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              actions.onRegenerate("");
            }}
          >
            <RotateCcwIcon />
            Làm lại khung
          </Button>
        </StudioEmpty>
      ) : (
        <>
          <ol className="flex flex-col gap-3">
            {outline.scenes.map((scene, index) => (
              <OutlineSceneCard
                key={scene.id}
                scene={scene}
                index={index}
                count={count}
                rewrite={rewrite}
                actions={actions}
              />
            ))}
          </ol>
          <Button variant="outline" size="sm" className="self-start" onClick={actions.onAdd}>
            <PlusIcon />
            Thêm cảnh
          </Button>
        </>
      )}
    </div>
  );
}

/** Asks the AI for a whole new outline that follows one remark. */
export function OutlineFeedback({ onRegenerate }: { onRegenerate: (feedback: string) => void }) {
  const [feedback, setFeedback] = useState("");
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/60 p-3">
      <label htmlFor={id} className="text-sm leading-none font-medium">
        Góp ý để AI làm lại cả khung
      </label>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (feedback.trim() === "") return;
          onRegenerate(feedback);
          setFeedback("");
        }}
      >
        <Input
          id={id}
          className="bg-background"
          maxLength={500}
          placeholder="Ví dụ: hook mạnh hơn"
          value={feedback}
          onChange={(event) => {
            setFeedback(event.target.value);
          }}
        />
        <Button type="submit" variant="outline" disabled={feedback.trim() === ""}>
          <RotateCcwIcon />
          Làm lại
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">Bản mới thay cả khung, kể cả chỗ bạn đã sửa tay.</p>
    </div>
  );
}
