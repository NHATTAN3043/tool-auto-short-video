"use client";

import type { LibraryMedia } from "@studio/domain";
import { useId } from "react";

import { BudgetStatus } from "@/features/settings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";

import type { ClipAnalysisController } from "../hooks/use-clip-analysis";
import { clipCostLine, clipsLine, skippedLines } from "../model";

/** The cost of analyzing the chosen videos, confirmed before the paid job is queued (ADR 0019). */
export function ClipAnalysisConfirmDialog({
  controller,
  items,
}: {
  controller: ClipAnalysisController;
  items: readonly LibraryMedia[];
}) {
  const { state } = controller;
  const pending = state.step === "confirm" || state.step === "requesting" ? state : null;
  const reanalyzeId = useId();
  const chosen = new Set(pending?.body.libraryIds ?? []);
  const anyAnalyzed = items.some((item) => chosen.has(item.id) && item.analysis !== undefined);
  const blocked = pending ? !pending.estimate.budget.allowed || pending.estimate.clips.length === 0 : true;

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) controller.reset();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Phân tích video?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              {pending ? (
                <>
                  <span>
                    ffmpeg cắt từng video thành các đoạn theo chỗ chuyển cảnh, rồi AI xem ảnh của từng đoạn và
                    mô tả. Sau đó Full AI và ô tìm media chọn được đúng đoạn trong video.
                  </span>
                  <span className="font-medium text-foreground">{clipsLine(pending.estimate)}</span>
                  <span className="font-medium text-foreground">{clipCostLine(pending.estimate)}</span>
                  {skippedLines(pending.estimate, items).map((line) => (
                    <span key={line} className="text-xs">
                      Bỏ qua {line}
                    </span>
                  ))}
                  <BudgetStatus check={pending.estimate.budget} />
                </>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pending && anyAnalyzed ? (
          <label htmlFor={reanalyzeId} className="flex items-start gap-2 text-sm">
            <input
              id={reanalyzeId}
              type="checkbox"
              className="mt-1"
              checked={pending.body.reanalyze === true}
              disabled={state.step === "requesting"}
              onChange={(event) => {
                controller.estimate({ libraryIds: pending.body.libraryIds, reanalyze: event.target.checked });
              }}
            />
            <span>Phân tích lại cả video đã phân tích (tốn phí lại, kết quả cũ được thay).</span>
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction
            disabled={blocked || state.step === "requesting"}
            onClick={(event) => {
              event.preventDefault();
              controller.confirm();
            }}
          >
            {state.step === "requesting" ? "Đang gửi…" : "Phân tích"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
