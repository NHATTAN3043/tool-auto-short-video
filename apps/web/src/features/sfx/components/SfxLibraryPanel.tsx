"use client";

import { ACCEPTED_EXTENSIONS, type LibrarySfx } from "@studio/domain";
import { Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

import { sfxFileUrl } from "../api";
import { formatSfxLength } from "../format";
import type { SfxLibraryState } from "../hooks/use-sfx-library";

const ACCEPT = ACCEPTED_EXTENSIONS.audio.map((extension) => `.${extension}`).join(",");

/** Renames on blur or Enter; keeps its own text while typing. */
function NameField({ item, onRename }: { item: LibrarySfx; onRename: (name: string) => void }) {
  const [text, setText] = useState(item.name);
  const commit = () => {
    const name = text.trim();
    if (name === "") setText(item.name);
    else if (name !== item.name) onRename(name);
  };
  return (
    <Input
      aria-label={`Tên hiệu ứng ${item.name}`}
      className="h-8 min-w-0 flex-1"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

/** Upload once, use in every project: picking an effect in a scene copies it into that project. */
export function SfxLibraryPanel({ library }: { library: SfxLibraryState }) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Thư viện hiệu ứng âm thanh</CardTitle>
          <CardDescription>
            Dùng chung cho mọi dự án. Tải lên mp3, wav hoặc m4a (tiếng pop, whoosh, meme…), rồi thêm vào từng
            cảnh ở mục “Hiệu ứng âm thanh”.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={library.uploading}
          onClick={() => {
            input.current?.click();
          }}
        >
          <UploadIcon />
          {library.uploading ? "Đang tải lên…" : "Tải hiệu ứng lên"}
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length > 0) void library.upload(files);
          }}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {library.error ? (
          <div
            role="alert"
            className="flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {library.error}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Đóng"
              onClick={() => {
                library.setError(null);
              }}
            >
              <XIcon />
            </Button>
          </div>
        ) : null}
        {library.loading ? (
          <p className="text-sm text-muted-foreground">Đang tải thư viện…</p>
        ) : library.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có hiệu ứng nào.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {library.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                <NameField
                  key={item.name}
                  item={item}
                  onRename={(name) => {
                    void library.rename(item.id, name);
                  }}
                />
                <span className="w-16 text-right font-mono text-xs text-muted-foreground">
                  {formatSfxLength(item.durationMs)}
                </span>
                <audio controls preload="none" src={sfxFileUrl(item.id)} className="h-8 w-56" />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive"
                  aria-label={`Xoá ${item.name} khỏi thư viện`}
                  title="Xoá khỏi thư viện (các dự án đã dùng vẫn giữ bản sao)"
                  onClick={() => {
                    void library.remove(item.id);
                  }}
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
