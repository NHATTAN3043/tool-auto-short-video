"use client";

import type { LibraryMedia } from "@studio/domain";
import { RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
 * Stock media downloaded before, shared by every project. Tags decide what a search finds; deleting
 * only removes the library copy, projects keep theirs.
 */
export function SharedMediaLibrary() {
  const [items, setItems] = useState<LibraryMedia[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const replace = (next: LibraryMedia) => {
    setItems((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Thư viện media chung</CardTitle>
          <CardDescription>
            Video/ảnh stock đã tải về, dùng lại cho mọi dự án mà không tải lại. Tag quyết định khi tìm thấy.
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCwIcon />
          Tải lại
        </Button>
      </CardHeader>
      <CardContent>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {items?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa có gì. Media chọn từ Pexels/Pixabay sẽ tự được lưu vào đây.
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
                <TagsField item={item} onSaved={replace} />
                <Button
                  variant="ghost"
                  size="xs"
                  className="self-end text-destructive"
                  onClick={() => {
                    removeLibraryMedia(item.id).then(
                      () => {
                        setItems((current) => current?.filter((other) => other.id !== item.id) ?? null);
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
    </Card>
  );
}
