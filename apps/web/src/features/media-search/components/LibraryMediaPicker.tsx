"use client";

import type { LibraryMedia } from "@studio/domain";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import { importCandidate, listLibraryMedia, type PickedMedia } from "../api";
import { filterLibraryMedia, type LibraryKindFilter } from "../library-picker";
import { formatDuration, libraryFileUrl } from "../model";

const message = (error: unknown) => (error instanceof Error ? error.message : "Không tải được media.");

/** Browse whole library files without a keyword search or paid analysis. */
export function LibraryMediaPicker({
  projectId,
  onPicked,
}: {
  projectId: string;
  onPicked: (picked: PickedMedia) => void;
}) {
  const [items, setItems] = useState<LibraryMedia[] | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<LibraryKindFilter>("all");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  // Synchronous guard also covers multiple clicks before React renders disabled buttons.
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    void listLibraryMedia().then(
      (loaded) => {
        if (!active) return;
        setItems(loaded);
        setLoading(false);
      },
      (cause: unknown) => {
        if (!active) return;
        setLoadError(message(cause));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [revision]);

  const reload = () => {
    setLoading(true);
    setLoadError(null);
    setRevision((current) => current + 1);
  };

  const pick = async (item: LibraryMedia) => {
    if (pending.current) return;
    pending.current = true;
    setPicking(item.id);
    setPickError(null);
    try {
      // Capture the originating scene's callback before waiting, even if the user switches scenes.
      const notify = onPicked;
      const picked = await importCandidate(
        projectId,
        { provider: "library", ref: item.id, kind: item.kind },
        "",
      );
      notify(picked);
    } catch (cause) {
      setPickError(message(cause));
    } finally {
      pending.current = false;
      setPicking(null);
    }
  };

  const visible = filterLibraryMedia(items ?? [], query, kind);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Lọc kho chung theo tên hoặc tag"
          placeholder="Lọc theo tên file hoặc tag…"
          className="min-w-40 flex-1"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <select
          aria-label="Loại media trong kho chung"
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          value={kind}
          onChange={(event) => {
            const value = event.target.value;
            setKind(value === "video" || value === "image" ? value : "all");
          }}
        >
          <option value="all">Tất cả</option>
          <option value="video">Video</option>
          <option value="image">Ảnh</option>
        </select>
        <Button variant="outline" size="sm" disabled={loading || picking !== null} onClick={reload}>
          <RefreshCwIcon /> Tải lại
        </Button>
      </div>
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Đang tải kho chung…
        </p>
      ) : null}
      {loadError ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          {loadError}
          <Button variant="outline" size="sm" onClick={reload}>
            Thử lại
          </Button>
        </div>
      ) : null}
      {pickError ? (
        <p role="alert" className="text-sm text-destructive">
          {pickError}
        </p>
      ) : null}
      {!loading && !loadError && items?.length === 0 ? (
        <p className="text-sm text-muted-foreground">Kho chung chưa có media.</p>
      ) : null}
      {!loading && !loadError && items && items.length > 0 && visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">Không có media khớp bộ lọc.</p>
      ) : null}
      {!loading && !loadError && visible.length > 0 ? (
        <ul className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex w-full flex-col gap-1 rounded-md border p-1.5 text-left hover:border-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                disabled={picking !== null}
                onClick={() => {
                  void pick(item);
                }}
                aria-label={`Chọn ${item.fileName} cho cảnh`}
              >
                {item.kind === "video" && !item.thumbnailPath ? (
                  <video
                    src={libraryFileUrl(item.id, "media")}
                    muted
                    playsInline
                    preload="metadata"
                    className="aspect-video w-full rounded bg-muted object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- local library thumbnail
                  <img
                    src={libraryFileUrl(item.id, item.thumbnailPath ? "thumbnail" : "media")}
                    alt=""
                    loading="lazy"
                    className="aspect-video w-full rounded bg-muted object-cover"
                  />
                )}
                <span className="w-full truncate text-xs font-medium" title={item.fileName}>
                  {item.fileName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {picking === item.id ? "Đang nhập…" : item.kind === "video" ? "Video" : "Ảnh"}
                  {item.durationMs !== undefined ? ` · ${formatDuration(item.durationMs)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
