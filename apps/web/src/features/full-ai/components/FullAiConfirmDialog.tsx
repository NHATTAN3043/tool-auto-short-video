"use client";

import { formatUsd, type Project } from "@studio/domain";
import { useId, useState } from "react";

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

import type { FullAiController } from "../hooks/use-full-ai";
import { costLines, stepsLine } from "../model";

/** The cost of the whole run, and the replacement of the current scenes, confirmed before it starts. */
export function FullAiConfirmDialog({
  project,
  controller,
}: {
  project: Project;
  controller: FullAiController;
}) {
  const pending = controller.state.step === "confirm" ? controller.state : null;
  const mustReplace = project.scenes.length > 0;
  const [replace, setReplace] = useState(false);
  const replaceId = useId();
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReplace(false);
          controller.reset();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Chạy Full AI?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              {pending ? (
                <>
                  <span>
                    {stepsLine(pending.estimate.steps)} · khoảng {pending.estimate.sceneCount} cảnh.
                  </span>
                  <span className="flex flex-col text-xs">
                    {costLines(pending.estimate).map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </span>
                  <span className="font-medium text-foreground">
                    Tổng ≈ {formatUsd(pending.estimate.expectedUsd)} (tối đa{" "}
                    {formatUsd(pending.estimate.maxUsd)})
                  </span>
                  <BudgetStatus check={pending.estimate.budget} />
                  <span>Kết quả được áp ngay vào dự án; sau đó bạn duyệt và sửa từng cảnh.</span>
                </>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mustReplace ? (
          <label htmlFor={replaceId} className="flex items-start gap-2 text-sm">
            <input
              id={replaceId}
              type="checkbox"
              className="mt-1"
              checked={replace}
              onChange={(event) => {
                setReplace(event.target.checked);
              }}
            />
            <span>
              Thay toàn bộ {project.scenes.length} cảnh hiện có. File media đã tải lên vẫn được giữ trong dự
              án.
            </span>
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction
            disabled={!pending?.estimate.budget.allowed || (mustReplace && !replace)}
            onClick={() => {
              void controller.confirm(mustReplace && replace);
              setReplace(false);
            }}
          >
            Chạy Full AI
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
