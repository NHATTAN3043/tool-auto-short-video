"use client";

import {
  countWords,
  DEFAULT_MAX_WORDS_PER_SCENE,
  estimateSpeechMs,
  type ScriptSplitStrategy,
} from "@studio/domain";
import { InfoIcon, ScissorsIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/shared/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { Textarea } from "@/shared/ui/textarea";

import { formatMs, MAX_WORDS_PER_SCENE_LIMIT, parseMaxWords, previewSplit } from "../format";
import { SAMPLE_SCRIPT, SCRIPT_FORMAT_RULES, STRATEGY_LABELS, STRATEGY_ORDER } from "../labels";

function isStrategy(value: string): value is ScriptSplitStrategy {
  return (STRATEGY_ORDER as readonly string[]).includes(value);
}

export function ScriptPanel({
  script,
  sceneCount,
  onScriptChange,
  onScriptBlur,
  onSplit,
}: {
  script: string;
  sceneCount: number;
  onScriptChange: (script: string) => void;
  onScriptBlur: () => void;
  onSplit: (strategy: ScriptSplitStrategy, maxWordsPerScene: number) => void;
}) {
  // Form-only view state; the chosen strategy is not part of the project.
  const [strategy, setStrategy] = useState<ScriptSplitStrategy>("auto");
  const [maxWordsText, setMaxWordsText] = useState(String(DEFAULT_MAX_WORDS_PER_SCENE));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const words = countWords(script);
  const maxWords = parseMaxWords(maxWordsText);
  const usesWordLimit = strategy !== "paragraph";
  const canSplit = words > 0 && (!usesWordLimit || maxWords !== null);
  const limit = maxWords ?? DEFAULT_MAX_WORDS_PER_SCENE;
  const preview = useMemo(() => previewSplit(script, strategy, limit), [script, strategy, limit]);

  const split = () => {
    onSplit(strategy, maxWords ?? DEFAULT_MAX_WORDS_PER_SCENE);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Script</CardTitle>
        <CardDescription>
          Dán lời đọc của cả video (chỉ lời sẽ được đọc, không ghi chú cảnh quay). Mỗi cảnh là một đoạn lời đi
          kèm một hình/clip.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ScriptGuide
          defaultOpen={script.trim() === ""}
          maxWords={limit}
          onInsertSample={
            script.trim() === ""
              ? () => {
                  onScriptChange(SAMPLE_SCRIPT);
                }
              : undefined
          }
        />
        <Textarea
          aria-label="Script"
          className="min-h-40"
          value={script}
          placeholder="Dán script vào đây…"
          onChange={(event) => {
            onScriptChange(event.target.value);
          }}
          onBlur={onScriptBlur}
        />
        <p className="text-sm text-muted-foreground">
          {words} từ · ước lượng {words > 0 ? formatMs(estimateSpeechMs(script)) : "0:00,0"}
          {preview.sceneCount > 0 ? (
            <>
              {" "}
              · bấm “Tách cảnh” sẽ tạo <strong className="text-foreground">{preview.sceneCount} cảnh</strong>
            </>
          ) : null}
        </p>
        {preview.overLimitCount > 0 ? (
          <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            {preview.overLimitCount} cảnh dài hơn {limit} từ. Cảnh quá dài khiến một hình đứng lâu; hãy ngắt
            thêm đoạn hoặc chọn “Theo câu”.
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label>Cách tách cảnh</Label>
          <RadioGroup
            value={strategy}
            onValueChange={(value) => {
              if (isStrategy(value)) setStrategy(value);
            }}
            className="grid gap-3 sm:grid-cols-3"
          >
            {STRATEGY_ORDER.map((option) => (
              <Label
                key={option}
                htmlFor={`strategy-${option}`}
                className={cn(
                  "flex cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 font-normal transition-colors hover:bg-accent",
                  strategy === option && "border-primary ring-1 ring-primary",
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <RadioGroupItem id={`strategy-${option}`} value={option} />
                  {STRATEGY_LABELS[option].title}
                </span>
                <span className="text-xs text-muted-foreground">{STRATEGY_LABELS[option].description}</span>
              </Label>
            ))}
          </RadioGroup>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          {usesWordLimit ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="max-words">Số từ tối đa mỗi cảnh</Label>
              <Input
                id="max-words"
                inputMode="numeric"
                className="w-28"
                value={maxWordsText}
                aria-invalid={maxWords === null}
                onChange={(event) => {
                  setMaxWordsText(event.target.value);
                }}
              />
              {maxWords === null ? (
                <p className="text-sm text-destructive">
                  Nhập số nguyên từ 1 đến {MAX_WORDS_PER_SCENE_LIMIT}.
                </p>
              ) : null}
            </div>
          ) : (
            <span />
          )}
          <Button
            disabled={!canSplit}
            onClick={() => {
              if (sceneCount > 0) setConfirmOpen(true);
              else split();
            }}
          >
            <ScissorsIcon />
            Tách cảnh
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Thay toàn bộ {sceneCount} cảnh hiện có?</AlertDialogTitle>
            <AlertDialogDescription>
              Các cảnh sẽ được tạo lại từ script. Lời đã sửa, thời lượng nhập tay và mọi thứ gắn với cảnh cũ
              sẽ mất. Bạn có thể bấm “Hoàn tác” ngay sau đó nếu đổi ý.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={split}>Tách lại</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ScriptGuide({
  defaultOpen,
  maxWords,
  onInsertSample,
}: {
  defaultOpen: boolean;
  maxWords: number;
  onInsertSample?: () => void;
}) {
  return (
    <details open={defaultOpen} className="group rounded-lg border bg-muted/40 p-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium">
        <InfoIcon className="size-4" />
        Cách viết script để tách cảnh đúng ý
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-muted-foreground">Ngắt cảnh bằng một trong ba cách (dùng cách nào cũng được):</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {SCRIPT_FORMAT_RULES.map((rule) => (
            <div key={rule.title} className="flex flex-col gap-1">
              <span className="font-medium">{rule.title}</span>
              <pre className="whitespace-pre-wrap rounded-md border bg-background p-2 text-xs">
                {rule.example}
              </pre>
            </div>
          ))}
        </div>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Không ngắt gì: app tự gom các câu liền nhau, mỗi cảnh tối đa {maxWords} từ.</li>
          <li>Xuống dòng thường (không có dòng trống) vẫn được tính là cùng một cảnh.</li>
          <li>Mỗi cảnh nên dài 1–2 câu (khoảng 2–6 giây đọc) để hình thay đổi đủ nhanh.</li>
        </ul>
        {onInsertSample ? (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={onInsertSample}>
              Chèn script mẫu
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
