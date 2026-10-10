"use client";

import type { SearchLanguage } from "@studio/domain";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";

import { LANGUAGE_LABELS, type KeywordGroup } from "../model";

/** The scene's keywords per language: click to search here, or copy to search on another site. */
export function KeywordChips({
  groups,
  onSearch,
}: {
  groups: readonly KeywordGroup[];
  onSearch: (query: string, lang: SearchLanguage) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(text);
        setTimeout(() => {
          setCopied((current) => (current === text ? null : current));
        }, 1500);
      })
      .catch(() => undefined);
  };

  if (groups.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Cảnh chưa có từ khoá. Dùng “Gợi ý hình” ở Trợ lý AI để có từ khoá tiếng Anh, Việt và Trung.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <div key={group.lang} className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">{LANGUAGE_LABELS[group.lang]}</span>
          {group.queries.map((query) => (
            <span key={query} className="inline-flex items-center rounded-full border text-xs">
              <button
                type="button"
                className="rounded-l-full px-2 py-0.5 hover:bg-accent"
                title="Tìm với từ khoá này"
                onClick={() => {
                  onSearch(query, group.lang);
                }}
              >
                {query}
              </button>
              <button
                type="button"
                className="rounded-r-full border-l px-1.5 py-0.5 hover:bg-accent"
                aria-label={`Sao chép “${query}”`}
                title="Sao chép"
                onClick={() => {
                  copy(query);
                }}
              >
                {copied === query ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
              </button>
            </span>
          ))}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              copy(group.queries.join(", "));
            }}
          >
            {copied === group.queries.join(", ") ? "Đã chép" : "Chép tất cả"}
          </Button>
        </div>
      ))}
    </div>
  );
}
