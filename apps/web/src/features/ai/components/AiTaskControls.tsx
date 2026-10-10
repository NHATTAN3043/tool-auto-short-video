"use client";

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
import { BudgetStatus } from "@/features/settings";
import { Button } from "@/shared/ui/button";

import type { AiTaskController } from "../hooks/use-ai-task";
import { AI_TASK_LABELS, costLine, formatUsd } from "../model";

/** Paid call: shows the estimate and the budgets, and runs nothing until the user confirms. */
export function AiConfirmDialog({ controller }: { controller: AiTaskController }) {
  const { state } = controller;
  const pending = state.step === "confirm" ? state : null;
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) controller.reset();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pending ? `${AI_TASK_LABELS[pending.task.type]} bằng AI?` : ""}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-1">
              <span>Chi phí ước tính: {pending ? costLine(pending.estimate) : ""}.</span>
              {pending ? <BudgetStatus check={pending.estimate.budget} /> : null}
              {pending?.estimate.budget.allowed ? (
                <span>Kết quả chỉ là gợi ý: bạn xem lại rồi mới áp dụng vào dự án.</span>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction
            disabled={!pending?.estimate.budget.allowed}
            onClick={() => {
              void controller.confirm();
            }}
          >
            Chạy AI
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Progress and errors of one AI task. */
export function AiTaskStatus({ controller }: { controller: AiTaskController }) {
  const { state } = controller;
  if (state.step === "estimating") {
    return <p className="text-sm text-muted-foreground">Đang ước tính chi phí…</p>;
  }
  if (state.step === "running") {
    return (
      <p className="text-sm" role="status">
        {state.job.status === "QUEUED" ? "Đang chờ worker…" : "AI đang viết…"}
      </p>
    );
  }
  if (state.step === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
        {state.message}
        <Button variant="ghost" size="sm" onClick={controller.reset}>
          Đóng
        </Button>
      </div>
    );
  }
  if (state.step === "review") {
    return (
      <p className="text-xs text-muted-foreground">Chi phí lượt này: {formatUsd(state.result.usage.usd)}</p>
    );
  }
  return null;
}
