"use client";

import type { VisualPlan } from "@studio/domain";
import { ImageIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";

import { parseQueries } from "@/features/ai";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

/** Comma-separated keywords; typed text is kept as is until the field loses focus. */
function QueriesField({
  label,
  queries,
  onCommit,
}: {
  label: string;
  queries: readonly string[];
  onCommit: (queries: string[]) => void;
}) {
  const id = useId();
  const joined = queries.join(", ");
  const [text, setText] = useState(joined);
  const [last, setLast] = useState(joined);
  if (joined !== last) {
    setLast(joined);
    setText(joined);
  }
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={text}
        className="font-mono text-xs"
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={() => {
          const parsed = parseQueries(text);
          if (parsed.join(", ") !== joined) onCommit(parsed);
        }}
      />
    </div>
  );
}

/**
 * The scene's visual plan (usually from AI): intent, preferred media and search keywords in English,
 * Vietnamese and Chinese, all editable.
 */
export function VisualPlanEditor({
  sceneLabel,
  visualPlan,
  onChange,
  onCommit,
}: {
  sceneLabel: string;
  visualPlan: VisualPlan;
  onChange: (visualPlan: VisualPlan | null) => void;
  /** Ends typing in a field, so it is one undo step. */
  onCommit: () => void;
}) {
  const intentId = useId();
  const mediaId = useId();
  const localized = visualPlan.localizedQueries ?? { vi: [], zh: [] };
  const commitQueries = (next: VisualPlan) => {
    onChange(next);
    onCommit();
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ImageIcon className="size-4" />
          Gợi ý hình ảnh
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Xoá gợi ý hình ảnh của ${sceneLabel}`}
          title="Xoá gợi ý hình ảnh"
          onClick={() => {
            onChange(null);
          }}
        >
          <XIcon />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-1">
          <Label htmlFor={intentId} className="text-xs font-normal text-muted-foreground">
            Ý đồ hình ảnh
          </Label>
          <Input
            id={intentId}
            value={visualPlan.intent}
            onChange={(event) => {
              onChange({ ...visualPlan, intent: event.target.value });
            }}
            onBlur={onCommit}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={mediaId} className="text-xs font-normal text-muted-foreground">
            Nên dùng
          </Label>
          <select
            id={mediaId}
            className="h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
            value={visualPlan.preferredMedia}
            onChange={(event) => {
              commitQueries({
                ...visualPlan,
                preferredMedia: event.target.value === "image" ? "image" : "video",
              });
            }}
          >
            <option value="video">Video</option>
            <option value="image">Ảnh</option>
          </select>
        </div>
      </div>
      <QueriesField
        label="Từ khoá tiếng Anh (cách nhau bằng dấu phẩy)"
        queries={visualPlan.searchQueries}
        onCommit={(searchQueries) => {
          commitQueries({ ...visualPlan, searchQueries });
        }}
      />
      <QueriesField
        label="Từ khoá tiếng Việt"
        queries={localized.vi}
        onCommit={(vi) => {
          commitQueries({ ...visualPlan, localizedQueries: { ...localized, vi } });
        }}
      />
      <QueriesField
        label="Từ khoá tiếng Trung (中文)"
        queries={localized.zh}
        onCommit={(zh) => {
          commitQueries({ ...visualPlan, localizedQueries: { ...localized, zh } });
        }}
      />
    </div>
  );
}
