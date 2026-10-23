"use client";

import type { MissingScene, SearchLanguage } from "@studio/domain";
import { CheckIcon, CopyIcon, CornerDownRightIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

import { MISSING_REASON_LABELS, reviewSceneAnchor } from "../model";

const LANGUAGES: readonly { lang: SearchLanguage; label: string }[] = [
  { lang: "en", label: "English" },
  { lang: "vi", label: "Tiếng Việt" },
  { lang: "zh", label: "中文" },
];

/**
 * Scenes Full AI could not fill (ADR 0019): what each one needs and the keywords to look for elsewhere, so
 * the user knows which clips to download instead of checking every scene.
 */
export function MissingScenesPanel({ scenes }: { scenes: readonly (MissingScene & { number: number })[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (scenes.length === 0) return null;

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

  return (
    <Card className="border-amber-500/60">
      <CardHeader>
        <CardTitle>Cảnh thiếu ({scenes.length})</CardTitle>
        <CardDescription>
          Các cảnh này chưa có hình. Tải clip theo từ khoá rồi upload vào dự án (và phân tích), hoặc chọn tay
          trong &quot;Đổi media&quot;. Cảnh có hình rồi sẽ tự rời khỏi danh sách.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {scenes.map((scene) => (
            <li key={scene.sceneId} className="flex flex-col gap-1.5 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  Cảnh {scene.number}
                  <Badge variant="outline">{MISSING_REASON_LABELS[scene.reason]}</Badge>
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    document
                      .getElementById(reviewSceneAnchor(scene.sceneId))
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  <CornerDownRightIcon />
                  Đến cảnh
                </Button>
              </div>
              {scene.intent !== "" ? <p className="text-muted-foreground">Cần hình: {scene.intent}</p> : null}
              {LANGUAGES.map(({ lang, label }) =>
                scene.queries[lang].length > 0 ? (
                  <div key={lang} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
                    {scene.queries[lang].map((query) => (
                      <button
                        key={query}
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-accent"
                        aria-label={`Sao chép “${query}”`}
                        title="Sao chép"
                        onClick={() => {
                          copy(query);
                        }}
                      >
                        {query}
                        {copied === query ? (
                          <CheckIcon className="size-3" />
                        ) : (
                          <CopyIcon className="size-3" />
                        )}
                      </button>
                    ))}
                  </div>
                ) : null,
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
