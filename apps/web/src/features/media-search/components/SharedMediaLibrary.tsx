"use client";

import type { LibraryMedia } from "@studio/domain";
import { RefreshCwIcon, ScanSearchIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  analysisLabel,
  canAnalyze,
  ClipAnalysisConfirmDialog,
  clipJobView,
  ShotsDialog,
  useClipAnalysis,
} from "@/features/clip-analysis";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

import { listLibraryMedia, removeLibraryMedia, setLibraryMediaTags } from "../api";
import { formatDuration, LIBRARY_SOURCE_LABELS, libraryFileUrl, parseTags } from "../model";

const message = (error: unknown) => (error instanceof Error ? error.message : "Đã có lỗi xảy ra.");

function TagsField({ item, onSaved }: { item: LibraryMedia; onSaved: (item: LibraryMedia) => void }) {
  const joined = item.tags.join(", ");
  const [text, setText] = useState(joined);
  const [last, setLast] = useState(joined);
  if (joined !== last) {
    setLast(joined);
    setText(joined);
  }
  return (
    <Input
      aria-label="Tag"
      className="h-7 text-xs"
      value={text}
      placeholder="tag, cách nhau bằng dấu phẩy"
      onChange={(event) => {
        setText(event.target.value);
      }}
      onBlur={() => {
        const tags = parseTags(text);
        if (tags.join(", ") === joined) return;
        void setLibraryMediaTags(item.id, tags).then(onSaved, () => {
          setText(joined);
        });
      }}
    />
  );
}

/**
 * Stock media downloaded before and videos uploaded into projects, shared by every project. Tags decide what
 * a search finds; analyzed videos are found by their shots (ADR 0019). Deleting only removes the library
 * copy, projects keep theirs. Analysis is paid by `projectId`'s budget and needs an AI key.
 */
export function SharedMediaLibrary({ projectId, aiAvailable }: { projectId: string; aiAvailable: boolean }) {
  const [items, setItems] = useState<LibraryMedia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(() => {
    listLibraryMedia().then(
      (loaded) => {
        setItems(loaded);
        setError(null);
      },
      (cause: unknown) => {
        setError(message(cause));
      },
    );
  }, []);

  useEffect(load, [load]);

  const analysis = useClipAnalysis(projectId, load);
  const job = analysis.state.step === "job" ? clipJobView(analysis.state.job) : null;
  const busy = analysis.state.step !== "idle" && job?.state !== "done" && job?.state !== "failed";
  const toggle = (id: string, on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const replace = (next: LibraryMedia) => {
    setItems((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Thư viện media chung</CardTitle>
          <CardDescription>
            Video/ảnh stock đã tải về và video bạn tự tải lên, dùng lại cho mọi dự án. Tag quyết định khi tìm
            thấy; video đã phân tích được tìm theo từng đoạn.
          </CardDescription>
        </div>
        <div className="flex items-center gap-1">
          {aiAvailable ? (
            <Button
              variant="outline"
              size="sm"
              disabled={selected.size === 0 || busy}
              onClick={() => {
                analysis.estimate({ libraryIds: [...selected] });
              }}
            >
              <ScanSearchIcon />
              {selected.size > 0 ? `Phân tích (${String(selected.size)})` : "Phân tích"}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCwIcon />
            Tải lại
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {analysis.error ? <p className="text-sm text-destructive">{analysis.error}</p> : null}
        {job ? (
          <p
            className={cn(
              "text-sm",
              job.state === "failed"
                ? "text-destructive"
                : job.state === "done"
                  ? "text-emerald-600"
                  : "text-muted-foreground",
            )}
          >
            {job.text}
          </p>
        ) : null}
        {aiAvailable && items?.some(canAnalyze) ? (
          <p className="text-xs text-muted-foreground">
            Chọn video rồi bấm Phân tích: AI xem từng đoạn của video để Full AI chọn đúng đoạn cho mỗi cảnh.
            Có phí, hiện chi phí trước khi chạy.
          </p>
        ) : null}
        {items?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa có gì. Media chọn từ Pexels/Pixabay và video bạn tải lên sẽ tự được lưu vào đây.
          </p>
        ) : null}
        {items && items.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-1.5 overflow-hidden rounded-md border p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- local library thumbnail */}
                <img
                  src={libraryFileUrl(item.id, item.thumbnailPath ? "thumbnail" : "media")}
                  alt=""
                  loading="lazy"
                  className="aspect-video w-full rounded object-cover"
                />
                <span className="text-xs text-muted-foreground">
                  {LIBRARY_SOURCE_LABELS[item.source]} · {item.kind === "video" ? "Video" : "Ảnh"}
                  {item.durationMs !== undefined ? ` · ${formatDuration(item.durationMs)}` : ""} · dùng{" "}
                  {item.usageCount} lần
                </span>
                {canAnalyze(item) ? (
                  <div className="flex items-center justify-between gap-1 text-xs">
                    <label className="flex items-center gap-1.5">
                      {aiAvailable ? (
                        <input
                          type="checkbox"
                          aria-label={`Chọn ${item.fileName} để phân tích`}
                          checked={selected.has(item.id)}
                          onChange={(event) => {
                            toggle(item.id, event.target.checked);
                          }}
                        />
                      ) : null}
                      <span className={item.analysis ? "text-emerald-600" : "text-muted-foreground"}>
                        {analysisLabel(item)}
                      </span>
                    </label>
                    <ShotsDialog item={item} />
                  </div>
                ) : null}
                <TagsField item={item} onSaved={replace} />
                <Button
                  variant="ghost"
                  size="xs"
                  className="self-end text-destructive"
                  onClick={() => {
                    removeLibraryMedia(item.id).then(
                      () => {
                        setItems((current) => current?.filter((other) => other.id !== item.id) ?? null);
                        toggle(item.id, false);
                      },
                      (cause: unknown) => {
                        setError(message(cause));
                      },
                    );
                  }}
                >
                  <Trash2Icon />
                  Xoá
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
      <ClipAnalysisConfirmDialog controller={analysis} items={items ?? []} />
    </Card>
  );
}
