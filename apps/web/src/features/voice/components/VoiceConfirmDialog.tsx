"use client";

import { sceneVoiceStatus, type Project } from "@studio/domain";

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
  const verb = pending?.regenerate ? "Tạo lại giọng" : "Tạo giọng";
  const replacesUpload =
    pending?.regenerate === true &&
    project.scenes.some(
      (scene) =>
        pending.estimate.sceneIds.includes(scene.id) && sceneVoiceStatus(project, scene) === "uploaded",
    );
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
            {verb} cho cảnh {pending ? sceneNumbers(project, pending.estimate.sceneIds) : ""}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-1">
              <span>
                Chi phí ước tính: {pending ? estimateSummary(pending.estimate) : ""}. Giọng cũ của các cảnh
                này vẫn được giữ trong thư viện media.
              </span>
              {replacesUpload ? (
                <span>
                  Cảnh đang dùng file bạn tải lên. File đó vẫn còn trong thư viện, chọn lại được ở ô giọng của
                  cảnh.
                </span>
              ) : null}
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
            {verb}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
