"use client";

import { unanalyzedUploads, type LibraryMedia, type Project } from "@studio/domain";
import { ScanSearchIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { listLibraryMedia } from "@/features/media-search/api";

/**
 * Before a run: videos uploaded into this project that are not analyzed yet (ADR 0019). Full AI only finds
 * them by file name, so the user is told where to analyze them first. Says nothing when all are analyzed
 * or the library cannot be read.
 */
export function UnanalyzedClipsHint({ project }: { project: Project }) {
  const [items, setItems] = useState<LibraryMedia[] | null>(null);
  useEffect(() => {
    let active = true;
    listLibraryMedia().then(
      (loaded) => {
        if (active) setItems(loaded);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  const count = items === null ? 0 : unanalyzedUploads(project.assets, items).length;
  if (count === 0) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-500/60 p-2 text-sm">
      <ScanSearchIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <span>
        Còn {count} video bạn tự tải lên dự án này chưa phân tích: Full AI chỉ tìm được chúng theo tên file.
        Mở tab Thư viện của dự án, chọn các video đó trong &quot;Thư viện media chung&quot; và bấm Phân tích
        để Full AI chọn được đúng đoạn.
      </span>
    </p>
  );
}
