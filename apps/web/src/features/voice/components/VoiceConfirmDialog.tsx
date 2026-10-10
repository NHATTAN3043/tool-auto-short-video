"use client";

import type { Project } from "@studio/domain";

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

import type { VoiceJobsState } from "../hooks/use-voice-jobs";
import { estimateSummary, sceneNumbers } from "../model";

/** Paid call: the estimated cost is shown and nothing runs until the user confirms. */
export function VoiceConfirmDialog({ project, jobs }: { project: Project; jobs: VoiceJobsState }) {
  const pending = jobs.pending;
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) jobs.cancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Tạo giọng cho cảnh {pending ? sceneNumbers(project, pending.estimate.sceneIds) : ""}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-1">
              <span>
                Chi phí ước tính: {pending ? estimateSummary(pending.estimate) : ""}. Giọng cũ của các cảnh
                này vẫn được giữ trong thư viện media.
              </span>
              {pending ? <BudgetStatus check={pending.estimate.budget} /> : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction
            disabled={jobs.busy || pending?.estimate.budget.allowed === false}
            onClick={() => {
              void jobs.confirm();
            }}
          >
            Tạo giọng
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
