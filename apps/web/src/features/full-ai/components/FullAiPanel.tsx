"use client";

import { formatUsd, fullAiSteps, type MediaRankingMode, type Project } from "@studio/domain";
import { SparklesIcon } from "lucide-react";
import { useId, useState } from "react";

import { BudgetStatus } from "@/features/settings";
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
import { Textarea } from "@/shared/ui/textarea";

import type { FullAiController } from "../hooks/use-full-ai";
import {
  costLines,
  FULL_AI_DURATIONS,
  formError,
  initialForm,
  progressLine,
  stepsLine,
  toRequest,
  type FullAiForm,
} from "../model";
import { RankingModePicker } from "./RankingModePicker";

const SELECT_CLASS =
  "h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function ConfirmDialog({ project, controller }: { project: Project; controller: FullAiController }) {
  const pending = controller.state.step === "confirm" ? controller.state : null;
  const mustReplace = project.scenes.length > 0;
  const [replace, setReplace] = useState(false);
  const replaceId = useId();
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReplace(false);
          controller.reset();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Chạy Full AI?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              {pending ? (
                <>
                  <span>
                    {stepsLine(pending.estimate.steps)} · khoảng {pending.estimate.sceneCount} cảnh.
                  </span>
                  <span className="flex flex-col text-xs">
                    {costLines(pending.estimate).map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </span>
                  <span className="font-medium text-foreground">
                    Tổng ≈ {formatUsd(pending.estimate.expectedUsd)} (tối đa{" "}
                    {formatUsd(pending.estimate.maxUsd)})
                  </span>
                  <BudgetStatus check={pending.estimate.budget} />
                  <span>Kết quả được áp ngay vào dự án; sau đó bạn duyệt và sửa từng cảnh.</span>
                </>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mustReplace ? (
          <label htmlFor={replaceId} className="flex items-start gap-2 text-sm">
            <input
              id={replaceId}
              type="checkbox"
              className="mt-1"
              checked={replace}
              onChange={(event) => {
                setReplace(event.target.checked);
              }}
            />
            <span>
              Thay toàn bộ {project.scenes.length} cảnh hiện có. File media đã tải lên vẫn được giữ trong dự
              án.
            </span>
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction
            disabled={!pending?.estimate.budget.allowed || (mustReplace && !replace)}
            onClick={() => {
              void controller.confirm(mustReplace && replace);
              setReplace(false);
            }}
          >
            Chạy Full AI
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Starts a Full AI run: idea → script → scenes → media → voices, as far as the toggles allow. The cost
 * and the budgets are shown before anything runs.
 */
export function FullAiPanel({
  project,
  ttsAvailable,
  controller,
  onRankingModeChange,
}: {
  project: Project;
  ttsAvailable: boolean;
  controller: FullAiController;
  /** Remembers the mode in the project, preselected next time. */
  onRankingModeChange: (mode: MediaRankingMode) => void;
}) {
  const [form, setForm] = useState<FullAiForm>(() => initialForm(project));
  const steps = fullAiSteps(project.automationSettings, { tts: ttsAvailable });
  const error = formError(form, steps, project);
  const ids = { idea: useId(), duration: useId(), tone: useId() };
  const { state } = controller;
  const change = (patch: Partial<FullAiForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4" />
          Full AI
        </CardTitle>
        <CardDescription>Các bước sẽ chạy theo cài đặt dự án: {stepsLine(steps)}.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {steps.includes("script") ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.idea}>Ý tưởng</Label>
            <Textarea
              id={ids.idea}
              rows={3}
              maxLength={2000}
              placeholder="Ví dụ: 5 sự thật thú vị về loài mèo"
              value={form.idea}
              onChange={(event) => {
                change({ idea: event.target.value });
              }}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Dùng script hiện tại của dự án.</p>
        )}

        <div className="flex flex-wrap gap-4">
          {steps.includes("script") ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.duration}>Thời lượng</Label>
              <select
                id={ids.duration}
                className={SELECT_CLASS}
                value={form.targetDurationSec}
                onChange={(event) => {
                  change({ targetDurationSec: Number(event.target.value) });
                }}
              >
                {FULL_AI_DURATIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} giây
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {steps.includes("script") ? (
            <div className="flex min-w-48 flex-1 flex-col gap-1.5">
              <Label htmlFor={ids.tone}>Giọng văn (tuỳ chọn)</Label>
              <Input
                id={ids.tone}
                maxLength={200}
                placeholder="hài hước, truyền cảm hứng…"
                value={form.tone}
                onChange={(event) => {
                  change({ tone: event.target.value });
                }}
              />
            </div>
          ) : null}
        </div>

        {steps.includes("rank") ? (
          <div className="flex flex-col gap-1.5">
            <Label>Cách AI xếp hạng media</Label>
            <RankingModePicker
              value={form.rankingMode}
              onChange={(rankingMode) => {
                change({ rankingMode });
                onRankingModeChange(rankingMode);
              }}
            />
          </div>
        ) : null}

        {state.step === "running" ? (
          <p className="text-sm" role="status">
            {progressLine(state.job)}
          </p>
        ) : null}
        {state.step === "error" ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
            {state.message}
            <Button variant="ghost" size="sm" onClick={controller.reset}>
              Đóng
            </Button>
          </div>
        ) : null}
        {error && state.step === "idle" ? <p className="text-sm text-muted-foreground">{error}</p> : null}

        <div className="flex justify-end">
          <Button
            disabled={error !== null || state.step === "estimating" || state.step === "running"}
            onClick={() => {
              void controller.prepare(toRequest(form, false));
            }}
          >
            <SparklesIcon />
            {state.step === "estimating" ? "Đang ước tính…" : "Ước tính và chạy"}
          </Button>
        </div>
      </CardContent>

      <ConfirmDialog project={project} controller={controller} />
    </Card>
  );
}
