"use client";

import { CheckIcon, CircleAlertIcon, LoaderCircleIcon, Undo2Icon } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import type { AutosaveStatus } from "../autosave";

const STATUS_TEXT: Record<AutosaveStatus, string> = {
  idle: "",
  pending: "Có thay đổi…",
  saving: "Đang lưu…",
  saved: "Đã lưu",
  error: "Lỗi khi lưu",
};

const STATUS_ICON: Partial<Record<AutosaveStatus, typeof CheckIcon>> = {
  saving: LoaderCircleIcon,
  saved: CheckIcon,
  error: CircleAlertIcon,
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
  const Icon = STATUS_ICON[status];
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-sm whitespace-nowrap",
          status === "error" ? "text-destructive" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {Icon ? <Icon className={cn("size-4", status === "saving" && "animate-spin")} /> : null}
        {STATUS_TEXT[status]}
      </span>
      {status === "error" ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Thử lại
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Hoàn tác"
        title="Hoàn tác"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2Icon />
      </Button>
    </div>
  );
}
