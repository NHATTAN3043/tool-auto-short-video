import type { RenderJob } from "@studio/domain";
import { Loader2Icon } from "lucide-react";

import { progressLine } from "../model";

/**
 * Covers the editor while the worker changes the project, so no edit is saved over its work. The
 * review screen opens when the run is done.
 */
export function FullAiLock({ job }: { job: RenderJob }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-label="Full AI đang chạy"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg border bg-background p-6 text-center shadow-lg">
        <Loader2Icon className="size-6 animate-spin" />
        <p className="font-medium">Full AI đang chạy</p>
        <p className="text-sm text-muted-foreground" role="status">
          {progressLine(job)}
        </p>
        <p className="text-xs text-muted-foreground">
          Trình chỉnh sửa tạm khoá để không ghi đè kết quả. Xong sẽ tự mở màn duyệt.
        </p>
      </div>
    </div>
  );
}
