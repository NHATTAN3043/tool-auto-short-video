"use client";

import { Undo2Icon } from "lucide-react";

import { Button } from "@/shared/ui/button";

import type { AutosaveStatus } from "../autosave";

const STATUS_TEXT: Record<AutosaveStatus, string> = {
  idle: "",
  pending: "Có thay đổi…",
  saving: "Đang lưu…",
  saved: "Đã lưu",
  error: "Lỗi khi lưu",
};

export function SaveIndicator({
  status,
  canUndo,
  onUndo,
  onRetry,
}: {
  status: AutosaveStatus;
  canUndo: boolean;
  onUndo: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
        aria-live="polite"
      >
        {STATUS_TEXT[status]}
      </span>
      {status === "error" ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Thử lại
        </Button>
      ) : null}
      <Button variant="outline" size="sm" disabled={!canUndo} onClick={onUndo}>
        <Undo2Icon />
        Hoàn tác
      </Button>
    </div>
  );
}
